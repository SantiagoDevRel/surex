// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {SureXOffchainResolver} from "../src/SureXOffchainResolver.sol";

/**
 * Deploy the resolver.
 *
 * Reads everything from the environment so no address and no key is ever written
 * into this repo (AGENTS.md §4: secrets never enter the repo).
 *
 *   SUREX_ENS_SIGNER       address whose key the gateway signs with
 *   SUREX_ENS_GATEWAY_URL  ERC-3668 URL template, MUST contain {sender} and {data}
 *   PRIVATE_KEY            the deployer, via --private-key or this variable
 *
 * Deploying is only half of it. Nothing resolves until `setResolver` is called on
 * the parent name — see contracts/README.md.
 */
contract Deploy is Script {
    function run() external returns (SureXOffchainResolver resolver) {
        address signer = vm.envAddress("SUREX_ENS_SIGNER");
        string memory url = vm.envString("SUREX_ENS_GATEWAY_URL");

        // A URL template missing its placeholders deploys fine and then fails every
        // lookup with an opaque gateway error. Catch it here instead.
        require(_contains(url, "{sender}"), "SUREX_ENS_GATEWAY_URL must contain {sender}");
        require(_contains(url, "{data}"), "SUREX_ENS_GATEWAY_URL must contain {data}");

        string[] memory urls = new string[](1);
        urls[0] = url;

        vm.startBroadcast();
        resolver = new SureXOffchainResolver(signer, urls);
        vm.stopBroadcast();

        console.log("SureXOffchainResolver:", address(resolver));
        console.log("signer:               ", signer);
        console.log("gateway:              ", url);
        console.log("");
        console.log("Next: setResolver(<parent node>, %s) on the ENS registry,", address(resolver));
        console.log("then set SUREX_ENS_RESOLVER_ADDRESS on the web deployment.");
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}
