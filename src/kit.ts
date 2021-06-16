import {Address, ContractKit} from "@celo/contractkit"
import {toTransactionObject} from "@celo/connect"
import {utils} from "ethers"

import {RomulusDelegate, ABI as romulusDelegateAbi} from "../types/web3-v1-contracts/RomulusDelegate"
import {IHasVotes, ABI as hasVotesAbi} from "../types/web3-v1-contracts/IHasVotes"

export enum Support {
  AGAINST = 0,
  FOR = 1,
  ABSTAIN = 2
}
export enum Sort {
  ASC = 0,
  DESC = 1,
}
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

/**
 * NomKit provides wrappers to interact with Nom contract.
 */
export class NomKit {
  public readonly contract: RomulusDelegate

  constructor(
    private kit: ContractKit,
    public readonly contractAddress: Address) {
    this.contract =
      new kit.web3.eth.Contract(romulusDelegateAbi, contractAddress) as unknown as RomulusDelegate
  }

  // Write: Proposer

  public propose = (
    targets: string[],
    values: (number | string)[],
    signatures: string[],
    calldatas: (string | number[])[],
    description: string
  ) => {
    const txo = this.contract.methods.propose(
      targets,
      values,
      signatures,
      calldatas,
      description,
    )
    return toTransactionObject(this.kit.connection, txo)
  }

  public queue = (proposalId: number | string) => {
    const txo = this.contract.methods.queue(proposalId)
    return toTransactionObject(this.kit.connection, txo)
  }

  public exeute = (proposalId: number | string) => {
    const txo = this.contract.methods.execute(proposalId)
    return toTransactionObject(this.kit.connection, txo)
  }

  public cancel = (proposalId: number | string) => {
    const txo = this.contract.methods.cancel(proposalId)
    return toTransactionObject(this.kit.connection, txo)
  }

  // Write: Voter

  public castVote = (proposalId: number | string, support: Support) => {
    const txo = this.contract.methods.castVote(proposalId, support)
    return toTransactionObject(this.kit.connection, txo)
  }

  public castVoteWithReason = (
    proposalId: number | string,
    support: Support,
    reason: string,
  ) => {
    const txo = this.contract.methods.castVoteWithReason(proposalId, support, reason)
    return toTransactionObject(this.kit.connection, txo)
  }

  // Read-only

  public proposalCount = async () => {
    return await this.contract.methods.proposalCount().call()
  }

  public quorumVotes = async () => {
    return await this.contract.methods.quorumVotes().call()
  }

  public getActions = async (proposalId: number | string) => {
    return await this.contract.methods.getActions(proposalId).call()
  }

  public state = async (proposalId: number | string) => {
    return await this.contract.methods.state(proposalId).call()
  }

  // Gets the receipt for a voter on a given proposal
  public getReceipt = async (proposalId: number | string, voter: Address) => {
    return await this.contract.methods.getReceipt(
      proposalId,
      voter,
    ).call()
  }

  public votingPower = async (proposalId: number | string, voter: Address) => {
    const [
      proposal,
      token,
      releaseToken,
    ] = await Promise.all([
      this.contract.methods.proposals(proposalId).call(),
      await this.contract.methods.token().call(),
      await this.contract.methods.releaseToken().call(),
    ])
    const {startBlock} = proposal

    const tokenContract =
      new this.kit.web3.eth.Contract(hasVotesAbi, token) as unknown as IHasVotes
    let releaseTokenContract: IHasVotes | undefined
    if (releaseToken !== ZERO_ADDRESS) {
      releaseTokenContract =
        new this.kit.web3.eth.Contract(hasVotesAbi, releaseToken) as unknown as IHasVotes
    }

    const tokenVotes =
      tokenContract.methods.getPriorVotes(voter, startBlock)
    const releaseTokenVotes =
      releaseTokenContract ? releaseTokenContract.methods.getPriorVotes(voter, startBlock) : 0
    return {tokenVotes, releaseTokenVotes}
  }

  // Fetch latest proposals with pagination
  // @param pageSize Number of elements to fetch
  // @param cursor The proposal index to start the page from
  // @param sort The direction of the page
  public proposals = async (pageSize: number, cursor: number, sort: Sort) => {
    if (pageSize === 0) {
      return []
    }
    const numProposals = Number(await this.contract.methods.proposalCount().call())
    if (cursor < 0 || cursor >= numProposals) {
      console.warn("RomulusKit: `from` is out of bounds")
      return []
    }

    const proposalIds = []
    let nextCursor: number | undefined;
    if (sort === Sort.ASC) {
      const start = cursor;
      const end = Math.min(numProposals, start + pageSize)
      if (end < numProposals - 1) {
        nextCursor = end + 1
      }
      for (let i = start; i <= end; i++) {
        proposalIds.push(i)
      }
    } else {
      const start = cursor;
      const end = Math.max(0, start - pageSize + 1)
      if (end > 0) {
        nextCursor = end - 1
      }
      for (let i = start; i >= end; i++) {
        proposalIds.push(i)
      }
    }
    const proposals = await Promise.all(proposalIds.map(id => this.contract.methods.proposals(id)))

    return {proposals, nextCursor}
  }
}
