// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice ENSIP-10 wildcard resolution. A resolver that answers for names it was
///         never explicitly given must implement this, and must report `0x9061b923`
///         from `supportsInterface` — without that, clients resolve the parent's
///         records and never call `resolve()` at all.
interface IExtendedResolver {
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory);
}

interface IERC165 {
    function supportsInterface(bytes4 interfaceID) external view returns (bool);
}

/**
 * SureX — an ERC-3668 (CCIP-Read) offchain resolver.
 *
 * One resolver set on one parent name resolves EVERY registry entry, present and
 * future, with no per-entry transaction: `sxf1-<40 hex>.<parent>.eth` where the
 * label carries the first 160 bits of an SXF-1 fingerprint. The registry holds 51
 * entries today and this contract does not know or care.
 *
 * Nothing is stored on chain except the signer and the gateway URLs. `resolve()`
 * always reverts with `OffchainLookup`; the client fetches the answer from the
 * gateway and hands it back to `resolveWithProof()`, which checks that the answer
 * was signed by the key this contract pins.
 *
 * WHAT THE SIGNATURE PROVES, EXACTLY: that this response came from the holder of
 * `signer`. It does not prove the registry is right, and it says nothing about the
 * server being described. SureX reviews servers; a review is a review, not a
 * warrant. The word is `reviewed` (AGENTS.md §4).
 *
 * WHAT IT DOES NOT DO: the SureX Gate — the Claude Code `PreToolUse` hook — does
 * not read this and is not made stronger by it. PRD risk #10 (the Gate acting on
 * unsigned responses) is unchanged and still listed as Accepted. Anyone reading
 * "signed" here and inferring otherwise has been misled, so it is written down.
 *
 * Deliberately dependency-free. The ENS `offchain-resolver` reference pulls
 * OpenZeppelin and the ens-contracts tree for what is ~60 lines of logic.
 */
contract SureXOffchainResolver is IExtendedResolver, IERC165 {
    /// @notice ERC-3668. The revert a CCIP-Read client is looking for.
    error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData);

    error SignatureExpired(uint64 expires, uint256 blockTimestamp);
    error UnknownSigner(address recovered);
    error MalformedSignature(uint256 length);
    error MalleableSignature();
    error NotOwner(address caller);
    error NoUrls();
    error ZeroAddress();

    /// @notice May rotate the signer and the gateway URLs. Nothing else.
    address public owner;

    /// @notice The address every response must recover to.
    address public signer;

    /// @dev ERC-3668 URL templates, e.g. `https://host/api/ens/{sender}/{data}.json`.
    string[] private _urls;

    event OwnerChanged(address indexed previous, address indexed next);
    event SignerChanged(address indexed previous, address indexed next);
    event UrlsChanged(string[] urls);

    constructor(address signer_, string[] memory urls_) {
        if (signer_ == address(0)) revert ZeroAddress();
        if (urls_.length == 0) revert NoUrls();
        owner = msg.sender;
        signer = signer_;
        _urls = urls_;
        emit OwnerChanged(address(0), msg.sender);
        emit SignerChanged(address(0), signer_);
        emit UrlsChanged(urls_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    /* ------------------------------------------------------------- rotation --*/

    /**
     * @notice Point the resolver at a different signing key.
     * @dev The whole reason this exists: a key that cannot be rotated is a
     *      liability the first time it is exposed. Rotating invalidates every
     *      signature already in flight, which is the intended behaviour.
     */
    function setSigner(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit SignerChanged(signer, next);
        signer = next;
    }

    /// @dev `memory` and not `calldata`: solc's legacy code generator cannot copy a
    ///      nested calldata dynamic array (`string[]`) into storage, and turning on
    ///      via-ir for one setter is a poor trade. FRICTION-LOG E3.
    function setUrls(string[] memory next) external onlyOwner {
        if (next.length == 0) revert NoUrls();
        _urls = next;
        emit UrlsChanged(next);
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnerChanged(owner, next);
        owner = next;
    }

    /// @notice The gateway URL templates, as one array.
    function gatewayUrls() external view returns (string[] memory) {
        return _urls;
    }

    /* -------------------------------------------------------------- resolve --*/

    /**
     * @notice ENSIP-10 entry point. Always reverts.
     * @param name DNS-encoded name being resolved. Passed through untouched — the
     *             gateway takes the leftmost label out of it.
     * @param data The inner call (`text(bytes32,string)`, `addr(bytes32)`, …).
     *
     * `extraData` is `data` verbatim, matching the ENS reference, so the callback
     * hashes exactly the bytes the gateway hashed. Anything cleverer here is a
     * digest mismatch waiting to happen.
     */
    function resolve(bytes calldata name, bytes calldata data) external view override returns (bytes memory) {
        name; // ENSIP-10 passes the name to the gateway, not to this function.
        revert OffchainLookup(address(this), _urls, data, this.resolveWithProof.selector, data);
    }

    /**
     * @notice The digest the gateway signs and this contract checks.
     *
     * `0x1900` is EIP-191 version `0x00`, "data with intended validator" — the
     * validator being `target`, so a signature made for one resolver cannot be
     * replayed against another. Unchanged from the ENS reference on purpose: any
     * standard CCIP-Read client already knows how to produce it.
     */
    function makeSignatureHash(address target, uint64 expires, bytes memory request, bytes memory result)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(hex"1900", target, expires, keccak256(request), keccak256(result)));
    }

    /**
     * @notice ERC-3668 callback. Reverts unless the response was signed by `signer`.
     * @param response abi.encode(bytes result, uint64 expires, bytes signature)
     * @param extraData the original `resolve()` calldata, handed back by the client
     * @return the ABI-encoded answer to the inner call
     */
    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory)
    {
        (bytes memory result, uint64 expires, bytes memory signature) =
            abi.decode(response, (bytes, uint64, bytes));

        if (expires < block.timestamp) revert SignatureExpired(expires, block.timestamp);

        address recovered = _recover(makeSignatureHash(address(this), expires, extraData, result), signature);
        if (recovered != signer) revert UnknownSigner(recovered);

        return result;
    }

    /* ------------------------------------------------------------- ERC-165 ---*/

    function supportsInterface(bytes4 interfaceID) external pure override returns (bool) {
        return interfaceID == type(IERC165).interfaceId // 0x01ffc9a7
            || interfaceID == type(IExtendedResolver).interfaceId; // 0x9061b923
    }

    /* ------------------------------------------------------------- internal --*/

    /// @dev The upper bound on `s` from EIP-2. Above it a second valid signature
    ///      exists for the same key and digest, so both are rejected outright
    ///      rather than left as two spellings of one answer.
    bytes32 private constant _MAX_S = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    function _recover(bytes32 digest, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) revert MalformedSignature(signature.length);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (v < 27) v += 27;
        if (uint256(s) > uint256(_MAX_S)) revert MalleableSignature();

        address recovered = ecrecover(digest, v, r, s);
        // `ecrecover` returns the zero address on a bad signature rather than
        // reverting. Left unchecked, a garbage signature would be compared against
        // `signer` — and would pass if `signer` were ever zero.
        if (recovered == address(0)) revert UnknownSigner(recovered);
        return recovered;
    }
}
