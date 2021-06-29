// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "../RomulusDelegate.sol";

contract RomulusDelegateMock is RomulusDelegate {
  /**
   * @notice Function for setting the voting period
   * @param newVotingPeriod new voting period, in blocks
   */
  function _setVotingPeriod(uint256 newVotingPeriod) external override {
    uint256 oldVotingPeriod = votingPeriod;
    votingPeriod = newVotingPeriod;

    emit VotingPeriodSet(oldVotingPeriod, votingPeriod);
  }
}
