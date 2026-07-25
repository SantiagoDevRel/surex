// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SureXOffchainResolver, IExtendedResolver, IERC165} from "../src/SureXOffchainResolver.sol";

/**
 * The resolver's own suite.
 *
 * The one test here that matters more than the others is `test_goldenDigestVector`.
 * Everything else checks this contract against itself; that one checks it against
 * the gateway in `apps/web`, which is written in a different language, in a
 * different package, by a different half of the build. A digest disagreement
 * between the signer and the verifier makes every single lookup fail
 * `resolveWithProof` with no useful error, and nothing else in either suite would
 * catch it.
 *
 * The same four inputs and the same expected digest are pinned in
 * `apps/web/test/ens.test.mjs`, which asserts the literal below appears in THIS
 * file. Changing one without the other breaks a test, which is the point.
 */
contract SureXOffchainResolverTest is Test {
    SureXOffchainResolver internal resolver;

    uint256 internal constant SIGNER_PK = 0xA11CE;
    uint256 internal constant STRANGER_PK = 0xB0B;
    address internal signer;
    address internal stranger;

    string[] internal urls;

    /* ------------------------------------------ the cross-language vector ---*/

    address internal constant GOLDEN_RESOLVER = 0x1111111111111111111111111111111111111111;
    uint64 internal constant GOLDEN_EXPIRES = 2000000000;
    bytes internal constant GOLDEN_CALLDATA = hex"00112233445566778899aabbccddeeff";
    /// @dev `abi.encode(string("flagged"))` — what a `text()` call actually returns.
    bytes internal constant GOLDEN_RESULT =
        hex"0000000000000000000000000000000000000000000000000000000000000020"
        hex"0000000000000000000000000000000000000000000000000000000000000007"
        hex"666c616767656400000000000000000000000000000000000000000000000000";
    bytes32 internal constant GOLDEN_DIGEST = 0xb344ec8556d204183db10bcdac4e9d28cfbb2f81ccc401c04c3809181edff00f;

    function setUp() public {
        signer = vm.addr(SIGNER_PK);
        stranger = vm.addr(STRANGER_PK);
        urls.push("https://arkiv-surex.vercel.app/api/ens/{sender}/{data}.json");
        resolver = new SureXOffchainResolver(signer, urls);
        // Otherwise `block.timestamp` is 1 and every expiry test is vacuous.
        vm.warp(1_700_000_000);
    }

    /* ------------------------------------------------------------ helpers ---*/

    function _sign(uint256 pk, uint64 expires, bytes memory callData, bytes memory result)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = resolver.makeSignatureHash(address(resolver), expires, callData, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _response(uint256 pk, uint64 expires, bytes memory callData, bytes memory result)
        internal
        view
        returns (bytes memory)
    {
        return abi.encode(result, expires, _sign(pk, expires, callData, result));
    }

    function _textCall() internal pure returns (bytes memory) {
        return abi.encodeWithSignature("text(bytes32,string)", bytes32(uint256(0xfeed)), "surex:state");
    }

    /* -------------------------------------------------------- golden vector --*/

    function test_goldenDigestVector() public pure {
        // Recomputed here rather than read off the contract so the constant is
        // pinned to the FORMULA, not to whatever the deployed code happens to do.
        bytes32 computed = keccak256(
            abi.encodePacked(
                hex"1900",
                GOLDEN_RESOLVER,
                GOLDEN_EXPIRES,
                keccak256(GOLDEN_CALLDATA),
                keccak256(GOLDEN_RESULT)
            )
        );
        assertEq(computed, GOLDEN_DIGEST, "digest formula drifted from the JS gateway");
    }

    function test_makeSignatureHashMatchesGoldenVector() public view {
        assertEq(
            resolver.makeSignatureHash(GOLDEN_RESOLVER, GOLDEN_EXPIRES, GOLDEN_CALLDATA, GOLDEN_RESULT),
            GOLDEN_DIGEST,
            "makeSignatureHash disagrees with the pinned vector"
        );
    }

    /// The digest binds the resolver address, so a response made for one resolver
    /// cannot be replayed against another. That is what `0x1900` is for.
    function test_digestIsBoundToTheResolverAddress() public view {
        bytes32 mine = resolver.makeSignatureHash(address(resolver), GOLDEN_EXPIRES, GOLDEN_CALLDATA, GOLDEN_RESULT);
        assertTrue(mine != GOLDEN_DIGEST, "digest ignored the resolver address");
    }

    /* -------------------------------------------------------- resolveWithProof */

    function test_happyPath() public view {
        bytes memory callData = _textCall();
        bytes memory result = abi.encode(string("flagged"));
        bytes memory response = _response(SIGNER_PK, uint64(block.timestamp + 300), callData, result);

        bytes memory got = resolver.resolveWithProof(response, callData);
        assertEq(abi.decode(got, (string)), "flagged");
    }

    function test_rejectsWrongSigner() public {
        bytes memory callData = _textCall();
        bytes memory result = abi.encode(string("clean"));
        bytes memory response = _response(STRANGER_PK, uint64(block.timestamp + 300), callData, result);

        vm.expectRevert(abi.encodeWithSelector(SureXOffchainResolver.UnknownSigner.selector, stranger));
        resolver.resolveWithProof(response, callData);
    }

    function test_rejectsExpired() public {
        bytes memory callData = _textCall();
        bytes memory result = abi.encode(string("flagged"));
        uint64 expires = uint64(block.timestamp - 1);
        bytes memory response = _response(SIGNER_PK, expires, callData, result);

        vm.expectRevert(
            abi.encodeWithSelector(SureXOffchainResolver.SignatureExpired.selector, expires, block.timestamp)
        );
        resolver.resolveWithProof(response, callData);
    }

    /// A signature that expires exactly now is still good — `<` not `<=`.
    function test_acceptsExpiryAtTheBoundary() public view {
        bytes memory callData = _textCall();
        bytes memory result = abi.encode(string("flagged"));
        bytes memory response = _response(SIGNER_PK, uint64(block.timestamp), callData, result);
        resolver.resolveWithProof(response, callData);
    }

    /// The attack the signature exists to stop: a gateway answer rewritten in
    /// flight from `flagged` to `clean`.
    function test_rejectsTamperedResult() public {
        bytes memory callData = _textCall();
        uint64 expires = uint64(block.timestamp + 300);
        bytes memory signature = _sign(SIGNER_PK, expires, callData, abi.encode(string("flagged")));
        bytes memory forged = abi.encode(abi.encode(string("clean")), expires, signature);

        vm.expectRevert();
        resolver.resolveWithProof(forged, callData);
    }

    /// And the same for the question: a signature over one name replayed onto another.
    function test_rejectsMismatchedCallData() public {
        bytes memory callData = _textCall();
        bytes memory other = abi.encodeWithSignature("text(bytes32,string)", bytes32(uint256(0xbeef)), "surex:state");
        bytes memory response = _response(SIGNER_PK, uint64(block.timestamp + 300), callData, abi.encode(string("flagged")));

        vm.expectRevert();
        resolver.resolveWithProof(response, other);
    }

    function test_rejectsMalformedSignature() public {
        bytes memory callData = _textCall();
        bytes memory response = abi.encode(abi.encode(string("flagged")), uint64(block.timestamp + 300), hex"1234");

        vm.expectRevert(abi.encodeWithSelector(SureXOffchainResolver.MalformedSignature.selector, uint256(2)));
        resolver.resolveWithProof(response, callData);
    }

    /// `ecrecover` answers the zero address on garbage instead of reverting.
    function test_rejectsGarbageSignature() public {
        bytes memory callData = _textCall();
        bytes memory signature = abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(1)), uint8(27));
        bytes memory response = abi.encode(abi.encode(string("flagged")), uint64(block.timestamp + 300), signature);

        vm.expectRevert();
        resolver.resolveWithProof(response, callData);
    }

    /* ---------------------------------------------------------------- resolve */

    function test_resolveRevertsWithOffchainLookup() public {
        bytes memory name = hex"057375726578036574680000";
        bytes memory data = _textCall();

        // The gateway is sent the WHOLE resolve(name, data) call, not `data`.
        bytes memory expected = abi.encodeWithSelector(SureXOffchainResolver.resolve.selector, name, data);

        vm.expectRevert(
            abi.encodeWithSelector(
                SureXOffchainResolver.OffchainLookup.selector,
                address(resolver),
                urls,
                expected,
                SureXOffchainResolver.resolveWithProof.selector,
                expected
            )
        );
        resolver.resolve(name, data);
    }

    /**
     * The regression test for the bug the first deployment shipped.
     *
     * `resolve()` used to forward `data` alone — the inner `text(bytes32,string)`
     * call. A node is a namehash and namehash is one-way, so a gateway holding
     * only that cannot recover the label, and the label is the only route to the
     * fingerprint. Every lookup 400'd against a gateway that was itself correct.
     *
     * Asserting the selector is not enough: the failure mode is a DROPPED NAME,
     * so this decodes the callData and checks the name survives the round trip.
     */
    function test_offchainCallDataCarriesTheName() public {
        bytes memory name = hex"057375726578036574680000";
        bytes memory data = _textCall();

        try resolver.resolve(name, data) {
            revert("resolve() must revert with OffchainLookup");
        } catch (bytes memory err) {
            assertEq(bytes4(err), SureXOffchainResolver.OffchainLookup.selector, "wrong error");

            (, , bytes memory callData, , bytes memory extraData) =
                abi.decode(_stripSelector(err), (address, string[], bytes, bytes4, bytes));

            assertEq(bytes4(callData), SureXOffchainResolver.resolve.selector, "callData must be a resolve() call");

            (bytes memory gotName, bytes memory gotData) =
                abi.decode(_stripSelector(callData), (bytes, bytes));
            assertEq(gotName, name, "the NAME must reach the gateway - it is the whole lookup key");
            assertEq(gotData, data, "the inner call must reach the gateway too");

            // resolveWithProof rebuilds the digest over these bytes; if extraData
            // and callData ever differ, every verification fails with no clue why.
            assertEq(extraData, callData, "extraData must equal callData");
        }
    }

    function _stripSelector(bytes memory payload) internal pure returns (bytes memory out) {
        require(payload.length >= 4, "too short");
        out = new bytes(payload.length - 4);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = payload[i + 4];
        }
    }

    /* -------------------------------------------------------------- ERC-165 --*/

    function test_supportsInterface() public view {
        assertTrue(resolver.supportsInterface(0x01ffc9a7), "ERC-165");
        // Without this one, clients never call `resolve()` and wildcard
        // resolution silently does not happen.
        assertTrue(resolver.supportsInterface(0x9061b923), "IExtendedResolver");
        assertEq(type(IERC165).interfaceId, bytes4(0x01ffc9a7));
        assertEq(type(IExtendedResolver).interfaceId, bytes4(0x9061b923));
        assertFalse(resolver.supportsInterface(0xffffffff));
        assertFalse(resolver.supportsInterface(0x3b3b57de), "addr(bytes32) is answered offchain, not claimed here");
    }

    /* ------------------------------------------------------------- rotation --*/

    function test_setSignerRotatesAndInvalidatesOldSignatures() public {
        bytes memory callData = _textCall();
        bytes memory result = abi.encode(string("flagged"));
        bytes memory response = _response(SIGNER_PK, uint64(block.timestamp + 300), callData, result);
        resolver.resolveWithProof(response, callData); // good now

        resolver.setSigner(stranger);
        assertEq(resolver.signer(), stranger);

        vm.expectRevert(abi.encodeWithSelector(SureXOffchainResolver.UnknownSigner.selector, signer));
        resolver.resolveWithProof(response, callData); // and not after
    }

    function test_onlyOwnerRotates() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(SureXOffchainResolver.NotOwner.selector, stranger));
        resolver.setSigner(stranger);

        string[] memory next = new string[](1);
        next[0] = "https://evil.example/{sender}/{data}.json";
        vm.expectRevert(abi.encodeWithSelector(SureXOffchainResolver.NotOwner.selector, stranger));
        resolver.setUrls(next);

        vm.expectRevert(abi.encodeWithSelector(SureXOffchainResolver.NotOwner.selector, stranger));
        resolver.transferOwnership(stranger);
        vm.stopPrank();
    }

    function test_setUrls() public {
        string[] memory next = new string[](2);
        next[0] = "https://a.example/{sender}/{data}.json";
        next[1] = "https://b.example/{sender}/{data}.json";
        resolver.setUrls(next);
        assertEq(resolver.gatewayUrls().length, 2);
        assertEq(resolver.gatewayUrls()[1], next[1]);
    }

    function test_rejectsZeroSignerAndEmptyUrls() public {
        vm.expectRevert(SureXOffchainResolver.ZeroAddress.selector);
        resolver.setSigner(address(0));

        string[] memory none = new string[](0);
        vm.expectRevert(SureXOffchainResolver.NoUrls.selector);
        resolver.setUrls(none);

        vm.expectRevert(SureXOffchainResolver.ZeroAddress.selector);
        new SureXOffchainResolver(address(0), urls);

        vm.expectRevert(SureXOffchainResolver.NoUrls.selector);
        new SureXOffchainResolver(signer, none);
    }
}
