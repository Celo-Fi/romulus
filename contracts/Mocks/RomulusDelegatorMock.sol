// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@nomspace/nomspace/contracts/interfaces/INom.sol";
import "../RomulusDelegator.sol";

contract RomulusDelegatorMock is RomulusDelegator {
  constructor(
    bytes32 timelock_,
    address token_,
    address releaseToken_,
    bytes32 admin_,
    address implementation_,
    uint votingPeriod_,
    uint votingDelay_,
    uint proposalThreshold_
  ) RomulusDelegator(timelock_, token_, releaseToken_, admin_, implementation_, votingPeriod_, votingDelay_, proposalThreshold_) {}

  function resolve(bytes32 addr) public pure override returns (address) {
    return address(uint160(uint256(addr) >> (12 * 8)));
  }
}

