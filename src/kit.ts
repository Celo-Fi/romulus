import {Address, ContractKit} from "@celo/contractkit"
import {toTransactionObject} from "@celo/connect"
import {RomulusDelegate, ABI as romulusDelegateAbi} from "../types/web3-v1-contracts/RomulusDelegate"
import {VotingToken, ABI as votingTokenAbi} from "../types/web3-v1-contracts/VotingToken"
import {toBN} from "web3-utils"

type ProposalEvent = {
  id: string;
  proposer: string;
  targets: string[];
  values: string[];
  signatures: string[]
  calldatas: string[]
  startBlock: string;
  endBlock: string;
  description: string;
}
type ProposalStruct = {
  eta: string;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  canceled: boolean;
  executed: boolean;
}
type ProposalReceipt = {
  hasVoted: boolean
  support: string
  votes: string
}
export type Proposal = ProposalEvent & ProposalStruct & ProposalReceipt

export enum Support {
  AGAINST = 0,
  FOR = 1,
  ABSTAIN = 2
}

export enum ProposalState {
  PENDING = 0,
  ACTIVE,
  CANCELED,
  DEFEATED,
  SUCCEEDED,
  QUEUED,
  EXPIRED,
  EXECUTED,
}

export enum Sort {
  ASC = 0,
  DESC = 1,
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

/**
 * RomulusKit provides wrappers to interact with RomulusDelegate contract.
 */
export class RomulusKit {
  public readonly contract: RomulusDelegate

  constructor(
    private kit: ContractKit,
    public readonly contractAddress?: Address) {
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

  public delegateToken = async (to: Address) => {
    const {token} = await this.getTokens()
    const txo = token.methods.delegate(to)
    return toTransactionObject(this.kit.connection, txo)
  }

  public delegateReleaseToken = async (to: Address) => {
    const {releaseToken} = await this.getTokens()
    if (!releaseToken) {
      return
    }
    const txo = releaseToken.methods.delegate(to)
    return toTransactionObject(this.kit.connection, txo)
  }

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
    return Number(await this.contract.methods.state(proposalId).call()) as ProposalState
  }

  // Gets the receipt for a voter on a given proposal
  public getReceipt = async (proposalId: number | string, voter: Address) => {
    return await this.contract.methods.getReceipt(
      proposalId,
      voter,
    ).call()
  }

  public currentDelegate = async (address: Address) => {
    const {token, releaseToken} = await this.getTokens()

    const tokenDelegate =
      token ? await token.methods.delegates(address).call() : ZERO_ADDRESS
    const releaseTokenDelegate =
      releaseToken ? await releaseToken.methods.delegates(address).call() : ZERO_ADDRESS

    return {
      tokenDelegate,
      releaseTokenDelegate,
    }
  }

  public hasReleaseToken = async () => {
    const {releaseToken} = await this.getTokens()
    return releaseToken != null
  }

  public tokenBalance = async (address: Address) => {
    const {token, releaseToken} = await this.getTokens()
    const tokenBalance =
      toBN(token ? await token.methods.balanceOf(address).call() : 0)
    const releaseTokenBalance =
      toBN(releaseToken ? await releaseToken.methods.balanceOf(address).call() : 0)

    return {
      tokenBalance,
      releaseTokenBalance,
      totalBalance: tokenBalance.add(releaseTokenBalance),
    }
  }

  public tokenSymbol = async () => {
    const {token, releaseToken} = await this.getTokens()
    const tokenSymbol =
      token ? await token.methods.symbol().call() : ""
    const releaseTokenSymbol =
      releaseToken ? await releaseToken.methods.symbol().call() : ""

    return {
      tokenSymbol,
      releaseTokenSymbol,
    }
  }

  public votingPower = async (voter: Address) => {
    const {token, releaseToken} = await this.getTokens()
    const tokenVotes =
      toBN(token ? await token.methods.getCurrentVotes(voter).call() : 0)
    const releaseTokenVotes =
      toBN(releaseToken ? await releaseToken.methods.getCurrentVotes(voter).call() : 0)

    return {
      tokenVotes,
      releaseTokenVotes,
      totalVotes: tokenVotes.add(releaseTokenVotes),
    }
  }

  public proposalVotingPower = async (proposalId: number | string, voter: Address) => {
    const {token, releaseToken} = await this.getTokens()
    const proposal = await this.contract.methods.proposals(proposalId).call()
    const {startBlock} = proposal

    const tokenVotes =
      toBN(token ? await token.methods.getPriorVotes(voter, startBlock).call() : 0)
    const releaseTokenVotes =
      toBN(releaseToken ? await releaseToken.methods.getPriorVotes(voter, startBlock).call() : 0)

    return {
      tokenVotes,
      releaseTokenVotes,
      totalVotes: tokenVotes.add(releaseTokenVotes),
    }
  }

  // Fetch latest proposals with pagination
  // @param voter View the proposals from the POV of this address
  public proposals = async (voter?: Address): Promise<Proposal[]> => {
    const proposalEvents = await this.contract.getPastEvents("ProposalCreated", {fromBlock: 0}).then((events) => events.map((event) => event.returnValues as ProposalEvent))

    const proposals = await Promise.all(proposalEvents.map(async (proposalEvent) => {
      const proposal = await this.contract.methods.proposals(proposalEvent.id).call()
      const receipt = voter ? await this.contract.methods.getReceipt(proposalEvent.id, voter).call() : {hasVoted: false, support: "0", votes: "0"}
      return {
        ...proposalEvent,
        ...proposal,
        ...receipt,
      }
    }))

    return proposals
  }

  private getTokens = async () => {
    const [
      tokenAddr,
      releaseTokenAddr,
    ] = await Promise.all([
      await this.contract.methods.token().call(),
      await this.contract.methods.releaseToken().call(),
    ])

    const token =
      new this.kit.web3.eth.Contract(votingTokenAbi, tokenAddr) as unknown as VotingToken

    let releaseToken: VotingToken | undefined
    if (releaseTokenAddr !== ZERO_ADDRESS) {
      releaseToken =
        new this.kit.web3.eth.Contract(votingTokenAbi, releaseTokenAddr) as unknown as VotingToken
    }
    return {token, releaseToken}
  }
}
