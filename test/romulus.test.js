require('chai').use(require('bn-chai')(web3.utils.BN)).use(require('chai-as-promised')).should()
const {
  encodeParameters,
  mineBlock,
  advanceBlocks,
} = require('./utils/Ethereum');
const EIP712 = require('./utils/EIP712');
const RLP = require('rlp')
const {toBN, toWei, toHex} = require('web3-utils');

const Poof = artifacts.require('POOFMock')
const Timelock = artifacts.require('TimelockMock')
const RomulusDelegator = artifacts.require('RomulusDelegatorMock')
const RomulusDelegate = artifacts.require('RomulusDelegateMock')

async function enfranchise(token, actor, amount) {
  await token.transfer(actor, amount)
  await token.delegate(actor, {from: actor})
}

async function getNextAddr(sender, offset = 0) {
  const nonce = await web3.eth.getTransactionCount(sender)
  return (
    '0x' +
    web3.utils
      .sha3(RLP.encode([sender, Number(nonce) + Number(offset)]))
      .slice(12)
      .substring(14)
  )
}

contract("RomulusDelegator", (accounts) => {
  let token, root, a1, a2, proposer, voter1, voter2, voter3, voter4, govDelegator, unlockedVoter;
  let targets, values, signatures, calldatas;

  const createProposal = async () => {
    await govDelegator.propose(targets, values, signatures, calldatas, "do nothing", {from: proposer});
    const proposalId = await govDelegator.latestProposalIds(proposer)
    return proposalId;
  }

  const cancelProposal = async (proposalId) => {
    await govDelegator.cancel(proposalId, {from: proposer});
  }

  before(async () => {
    [root, a1, proposer, voter1, voter2, voter3, voter4, a2] = accounts;

    const delegatorExpectedAddr = await getNextAddr(root, 3)

    token = await Poof.new([{to: root, amount: toWei("100000000")}])
    const timelock = await Timelock.new(delegatorExpectedAddr, 0)
    const govDelegate = await RomulusDelegate.new();
    govDelegator = await RomulusDelegator.new(
      timelock.address,
      token.address,
      toHex(0),
      timelock.address,
      govDelegate.address,
      17280,
      1,
      toWei("1000000"),
    );
    // Inherit ABI of RomulusDelegate, but call through the proxy (i.e. the delegator)
    govDelegator = await RomulusDelegate.at(govDelegator.address)
    // Set the voting period to 1 block
    await govDelegator._setVotingPeriod(5)

    targets = [a1];
    values = ["0"];
    signatures = ["getBalanceOf(address)"];
    calldatas = [encodeParameters(['address'], [a1])];

    // Set up an unlocked account
    unlockedVoter = web3.eth.accounts.create()
    web3.eth.accounts.wallet.add(unlockedVoter.privateKey)
    await web3.eth.sendTransaction({
      from: root,
      to: unlockedVoter.address,
      value: toWei("1")
    })
  });

  describe("#enfranchise", () => {
    it('should work', async () => {
      // Enfranchise voter2
      const voter2VotesBefore =
        await token.getPriorVotes(voter2, (await web3.eth.getBlock("latest")).number - 1)
      voter2VotesBefore.should.be.eq.BN("0")
      await enfranchise(token, voter2, toWei("7"));
      await mineBlock()
      const voter2VotesAfter =
        await token.getPriorVotes(voter2, (await web3.eth.getBlock("latest")).number - 1)
      voter2VotesAfter.should.be.eq.BN(toWei("7"))

      // Enfranchise voter3
      const voter3VotesBefore =
        await token.getPriorVotes(voter3, (await web3.eth.getBlock("latest")).number - 1)
      voter3VotesBefore.should.be.eq.BN("0")
      await enfranchise(token, voter3, toWei("6"));
      await mineBlock()
      const voter3VotesAfter =
        await token.getPriorVotes(voter3, (await web3.eth.getBlock("latest")).number - 1)
      voter3VotesAfter.should.be.eq.BN(toWei("6"))

      // Enfranchise voter4
      const voter4VotesBefore =
        await token.getPriorVotes(voter4, (await web3.eth.getBlock("latest")).number - 1)
      voter4VotesBefore.should.be.eq.BN("0")
      await enfranchise(token, voter4, toWei("4000001"));
      await mineBlock()
      const voter4VotesAfter =
        await token.getPriorVotes(voter4, (await web3.eth.getBlock("latest")).number - 1)
      voter4VotesAfter.should.be.eq.BN(toWei("4000001"))
    })
  })

  describe("#propose", () => {
    it("should revert if the proposer does not have enough tokens", async () => {
      await enfranchise(token, proposer, toWei("1000000"));
      await govDelegator.propose(targets, values, signatures, calldatas, "do nothing", {from: proposer}).should.be.rejectedWith("Romulus::propose: proposer votes below proposal threshold")
    })

    it("should work", async () => {
      await enfranchise(token, proposer, toWei("1"));
      let proposalId = await createProposal()
      proposalId.should.be.eq.BN(1)
    })

    it("should revert if the proposer already has an pending proposal", async () => {
      await createProposal().should.be.rejectedWith("Romulus::propose: one live proposal per proposer, found an already pending proposal")
    })

    it("should revert if the proposer already has an active proposal", async () => {
      await mineBlock()
      await createProposal().should.be.rejectedWith("Romulus::propose: one live proposal per proposer, found an already active proposal")
      await cancelProposal(1)
    })
  })

  describe('#getActions', () => {
    it('should work', async () => {
      const proposalId = await createProposal()
      const actions = await govDelegator.getActions(proposalId);
      assert.deepEqual(targets, actions.targets)
      assert.deepEqual(values, actions.values.map((bn) => bn.toString()))
      assert.deepEqual(signatures, actions.signatures)
      assert.deepEqual(calldatas, actions.calldatas)
      await cancelProposal(proposalId)
    })
  })

  describe("#voting", () => {
    it("should revert if the proposal does not exist", async () => {
      let proposalId = await createProposal(proposer)
      await govDelegator.castVote(proposalId.add(toBN(1)), 1, {from: voter1}).should.be.rejectedWith("Romulus::state: invalid proposal id")
      await cancelProposal(proposalId)
    });

    it("should revert if the proposal is pending", async () => {
      let proposalId = await createProposal(proposer)

      await govDelegator.castVote(proposalId, 1, {from: voter1}).should.be.rejectedWith("Romulus::castVoteInternal: voting is closed")
    });

    it("should work", async () => {
      const proposalId = await govDelegator.latestProposalIds(proposer);
      await mineBlock()
      await govDelegator.castVote(proposalId, 1, {from: voter1})
    })

    it("should revert if proposal already has an entry in its voter set", async () => {
      const proposalId = await govDelegator.latestProposalIds(proposer);
      await govDelegator.castVote(proposalId, 1, {from: voter1}).should.be.rejectedWith("revert Romulus::castVoteInternal: voter already voted")
      await cancelProposal(proposalId)
    });

    it("should add for votes correctly", async () => {
      const proposalId = await createProposal();
      let proposal = await govDelegator.proposals(proposalId);
      proposal.forVotes.should.be.eq.BN("0")

      await mineBlock();

      // voter2 votes
      await govDelegator.castVote(proposalId, 1, {from: voter2});
      proposal = await govDelegator.proposals(proposalId);
      proposal.forVotes.should.be.eq.BN(toWei("7"))

      // voter3 votes
      await govDelegator.castVote(proposalId, 1, {from: voter3});
      proposal = await govDelegator.proposals(proposalId);
      proposal.forVotes.should.be.eq.BN(toWei("13"))

      cancelProposal(proposalId)
    })

    it("should add against votes correctly", async () => {
      const proposalId = await createProposal();
      let proposal = await govDelegator.proposals(proposalId);
      proposal.againstVotes.should.be.eq.BN("0")

      await mineBlock();

      // voter2 votes
      await govDelegator.castVote(proposalId, 0, {from: voter2});
      proposal = await govDelegator.proposals(proposalId);
      proposal.againstVotes.should.be.eq.BN(toWei("7"))

      // voter3 votes
      await govDelegator.castVote(proposalId, 0, {from: voter3});
      proposal = await govDelegator.proposals(proposalId);
      proposal.againstVotes.should.be.eq.BN(toWei("13"))

      cancelProposal(proposalId)
    });
  });

  describe("#state", () => {
    it("should revert for a non-existent proposal", async () => {
      const proposalId = await govDelegator.latestProposalIds(proposer)
      await govDelegator.state(proposalId.add(toBN(1))).should.be.rejectedWith("Romulus::state: invalid proposal id")
    })

    it("should initialize to pending", async () => {
      const proposalId = await createProposal()
      const state = await govDelegator.state(proposalId)
      state.should.be.eq.BN("0")
    })

    it("should transition to active", async () => {
      await mineBlock();
      await mineBlock();

      const proposalId = await govDelegator.latestProposalIds(proposer)
      const state = await govDelegator.state(proposalId)
      state.should.be.eq.BN("1")
    })

    it("should show canceled", async () => {
      const proposalId = await govDelegator.latestProposalIds(proposer)
      await cancelProposal(proposalId)
      const state = await govDelegator.state(proposalId)
      state.should.be.eq.BN("2")
    })

    it("should show defeated", async () => {
      const proposalId = await createProposal()
      await advanceBlocks(10)
      const state = await govDelegator.state(proposalId)
      state.should.be.eq.BN("3")
      await cancelProposal(proposalId)
    })

    it("should show succeeded", async () => {
      const proposalId = await createProposal()
      await mineBlock();
      await mineBlock();

      await govDelegator.castVote(proposalId, 1, {from: voter4})
      await advanceBlocks(10)
      const state = await govDelegator.state(proposalId)
      state.should.be.eq.BN("4")
    })

    it("should show queued", async () => {
      const proposalId = await govDelegator.latestProposalIds(proposer)
      await govDelegator.queue(proposalId)
      const state = await govDelegator.state(proposalId)
      state.should.be.eq.BN("5")
    })

    it("should show executed", async () => {
      const proposalId = await govDelegator.latestProposalIds(proposer)
      await govDelegator.execute(proposalId)
      const state = await govDelegator.state(proposalId)
      state.should.be.eq.BN("7")
    })
  })

  describe("#getReceipt", () => {
    it("should work", async () => {
      const proposalId = await createProposal();
      await mineBlock();

      const receiptBefore = await govDelegator.getReceipt(proposalId, voter2)
      expect(receiptBefore.hasVoted).to.equal(false)
      await govDelegator.castVote(proposalId, 1, {from: voter2});
      const receiptAfter = await govDelegator.getReceipt(proposalId, voter2)
      expect(receiptAfter.hasVoted).to.equal(true)

      cancelProposal(proposalId)
    });
  });

  describe('castVoteBySig', () => {
    it('reverts if the signatory is invalid', async () => {
      const proposalId = await createProposal()
      await mineBlock();
      await govDelegator.castVoteBySig(proposalId, 0, 0, '0xbad', '0xbad', {from: voter2}).should.be.rejectedWith("Romulus::castVoteBySig: invalid signature");
      await cancelProposal(proposalId)
    });

    it('casts vote on behalf of the signatory', async () => {
      const Domain = {
        name: 'Romulus',
        chainId: 1, // await web3.eth.net.getId(); See: https://github.com/trufflesuite/ganache-core/issues/515
        verifyingContract: govDelegator.address
      };
      const Types = {
        Ballot: [
          {name: 'proposalId', type: 'uint256'},
          {name: 'support', type: 'uint8'},
        ]
      };

      await token.transfer(unlockedVoter.address, 1)
      const tokenContract = new web3.eth.Contract(Poof.abi, token.address)
      await tokenContract.methods.delegate(unlockedVoter.address).send({from: unlockedVoter.address, gas: 2e5})

      const proposalId = await createProposal()
      await mineBlock();

      // const tx = new web3.eth.Contract(RomulusDelegate.abi, govDelegator.address).methods
      const {v, r, s} = EIP712.sign(Domain, 'Ballot', {proposalId, support: 1}, Types, unlockedVoter.privateKey);

      let beforeFors = (await govDelegator.proposals(proposalId)).forVotes;
      await govDelegator.castVoteBySig(proposalId, 1, v, r, s, {from: root});

      let afterFors = (await govDelegator.proposals(proposalId)).forVotes;
      afterFors.sub(beforeFors).should.be.eq.BN("1")

      await cancelProposal(proposalId)
    });
  });

  describe("happy path", () => {
    it("should set voting delay to 100", async () => {
      const votingDelayBefore = await govDelegator.votingDelay()
      votingDelayBefore.should.be.eq.BN("1")

      await govDelegator.propose(
        [govDelegator.address],
        [0],
        ["_setVotingDelay(uint256)"],
        [encodeParameters(['uint256'], [100])],
        "Update voting delay to 100",
        {from: proposer})

      // Create
      const proposalId = await govDelegator.latestProposalIds(proposer)
      let state = await govDelegator.state(proposalId)
      state.should.be.eq.BN("0")

      // Move to active
      await advanceBlocks(2)
      state = await govDelegator.state(proposalId)
      state.should.be.eq.BN("1")

      // Move to succeed
      await govDelegator.castVote(proposalId, 1, {from: voter4})
      await advanceBlocks(10)
      state = await govDelegator.state(proposalId)
      state.should.be.eq.BN("4")

      // Move to queued
      await govDelegator.queue(proposalId)
      state = await govDelegator.state(proposalId)
      state.should.be.eq.BN("5")

      // Move to executed
      await govDelegator.execute(proposalId)
      state = await govDelegator.state(proposalId)
      state.should.be.eq.BN("7")

      const votingDelayAfter = await govDelegator.votingDelay()
      votingDelayAfter.should.be.eq.BN("100")
    })
  })
});
