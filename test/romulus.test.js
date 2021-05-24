require('chai').use(require('bn-chai')(web3.utils.BN)).use(require('chai-as-promised')).should()
const {
  encodeParameters,
  mineBlock,
  getUnlockedAccount,
  advanceBlocks,
} = require('./utils/Ethereum');
const EIP712 = require('./utils/EIP712');
const RLP = require('rlp')
const {toBN, toWei} = require('web3-utils')

const Poof = artifacts.require('POOFMock')
const Timelock = artifacts.require('TimelockMock')
const RomulusDelegate = artifacts.require('RomulusDelegate')

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

contract("RomulusDelegate", (accounts) => {
  let token, root, a1, otherAccounts, proposer, voter1, voter2, voter3, voter4, govDelegate, unlockedVoter;
  let targets, values, signatures, calldatas;

  const createProposal = async () => {
    await govDelegate.propose(targets, values, signatures, calldatas, "do nothing", {from: proposer});
    const proposalId = await govDelegate.latestProposalIds(proposer)
    return proposalId;
  }

  const cancelProposal = async (proposalId) => {
    await govDelegate.cancel(proposalId, {from: proposer});
  }

  before(async () => {
    [root, a1, proposer, voter1, voter2, voter3, voter4, ...otherAccounts] = accounts;
    unlockedVoter = await getUnlockedAccount()

    token = await Poof.new(root)
    const govDelegateAddress = await getNextAddr(root, 1);
    const timelock = await Timelock.new(govDelegateAddress, 0)
    govDelegate = await RomulusDelegate.new(timelock.address, token.address, 5760, 1, toWei("100000"));

    targets = [a1];
    values = ["0"];
    signatures = ["getBalanceOf(address)"];
    calldatas = [encodeParameters(['address'], [a1])];
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
      await enfranchise(token, voter4, toWei("400001"));
      await mineBlock()
      const voter4VotesAfter =
        await token.getPriorVotes(voter4, (await web3.eth.getBlock("latest")).number - 1)
      voter4VotesAfter.should.be.eq.BN(toWei("400001"))
    })
  })

  describe("#propose", () => {
    it("should revert if the proposer does not have enough tokens", async () => {
      await enfranchise(token, proposer, toWei("100000"));
      await govDelegate.propose(targets, values, signatures, calldatas, "do nothing", {from: proposer}).should.be.rejectedWith("Romulus::propose: proposer votes below proposal threshold")
    })

    it("should work if the proposer has enough tokens", async () => {
      await enfranchise(token, proposer, toWei("1"));

      // First proposal
      let proposalId = await createProposal()
      proposalId.should.be.eq.BN(0)
      await cancelProposal(proposalId)

      // Second proposal
      proposalId = await createProposal()
      proposalId.should.be.eq.BN(1)
      await cancelProposal(proposalId)
    })

    it("should revert if the proposer already has an active proposal", async () => {
      // First proposal
      let proposalId = await createProposal()
      proposalId.should.be.eq.BN(2)

      await mineBlock()

      // Second proposal
      await createProposal().should.be.rejectedWith("Romulus::propose: one live proposal per proposer, found an already active proposal")
      await cancelProposal(proposalId)
    })
  })

  describe('#getActions', () => {
    it('should work', async () => {
      const proposalId = await createProposal()
      const actions = await govDelegate.getActions(proposalId);
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
      await govDelegate.castVote(proposalId.add(toBN(1)), 1, {from: voter1}).should.be.rejectedWith("Romulus::state: invalid proposal id")
      await cancelProposal(proposalId)
    });

    it("should revert if the proposal is pending", async () => {
      let proposalId = await createProposal(proposer)

      await govDelegate.castVote(proposalId, 1, {from: voter1}).should.be.rejectedWith("Romulus::castVoteInternal: voting is closed")
    });

    it("should work", async () => {
      const proposalId = await govDelegate.latestProposalIds(proposer);
      await mineBlock()
      await govDelegate.castVote(proposalId, 1, {from: voter1})
    })

    it("should revert if proposal already has an entry in its voter set", async () => {
      const proposalId = await govDelegate.latestProposalIds(proposer);
      await govDelegate.castVote(proposalId, 1, {from: voter1}).should.be.rejectedWith("revert Romulus::castVoteInternal: voter already voted")
      await cancelProposal(proposalId)
    });

    it("should add for votes correctly", async () => {
      const proposalId = await createProposal();
      let proposal = await govDelegate.proposals(proposalId);
      proposal.forVotes.should.be.eq.BN("0")

      await mineBlock();

      // voter2 votes
      await govDelegate.castVote(proposalId, 1, {from: voter2});
      proposal = await govDelegate.proposals(proposalId);
      proposal.forVotes.should.be.eq.BN(toWei("7"))

      // voter3 votes
      await govDelegate.castVote(proposalId, 1, {from: voter3});
      proposal = await govDelegate.proposals(proposalId);
      proposal.forVotes.should.be.eq.BN(toWei("13"))

      cancelProposal(proposalId)
    })

    it("should add against votes correctly", async () => {
      const proposalId = await createProposal();
      let proposal = await govDelegate.proposals(proposalId);
      proposal.againstVotes.should.be.eq.BN("0")

      await mineBlock();

      // voter2 votes
      await govDelegate.castVote(proposalId, 0, {from: voter2});
      proposal = await govDelegate.proposals(proposalId);
      proposal.againstVotes.should.be.eq.BN(toWei("7"))

      // voter3 votes
      await govDelegate.castVote(proposalId, 0, {from: voter3});
      proposal = await govDelegate.proposals(proposalId);
      proposal.againstVotes.should.be.eq.BN(toWei("13"))

      cancelProposal(proposalId)
    });
  });

  describe("#state", () => {
    it("should revert for a non-existent proposal", async () => {
      const proposalId = await govDelegate.latestProposalIds(proposer)
      console.log(proposalId.toString(), (await govDelegate.proposalCount()).toString())
      await govDelegate.state(proposalId.add(toBN(1))).should.be.rejectedWith("Romulus::state: invalid proposal id")
    })

    it("should initialize to pending", async () => {
      const proposalId = await createProposal()
      const state = await govDelegate.state(proposalId)
      state.should.be.eq.BN("0")
    })

    it("should transition to active", async () => {
      await mineBlock();
      await mineBlock();

      const proposalId = await govDelegate.latestProposalIds(proposer)
      const state = await govDelegate.state(proposalId)
      state.should.be.eq.BN("1")
    })

    it("should show canceled", async () => {
      const proposalId = await govDelegate.latestProposalIds(proposer)
      await cancelProposal(proposalId)
      const state = await govDelegate.state(proposalId)
      state.should.be.eq.BN("2")
    })

    it("should show defeated", async () => {
      const proposalId = await createProposal()
      await advanceBlocks(6000) // TODO: Use time rather than blocks
      const state = await govDelegate.state(proposalId)
      state.should.be.eq.BN("3")
      await cancelProposal(proposalId)
    })

    it("should show succeeded", async () => {
      const proposalId = await createProposal()
      await mineBlock();
      await mineBlock();

      await govDelegate.castVote(proposalId, 1, {from: voter4})
      await advanceBlocks(6000) // TODO: Use time rather than blocks
      const state = await govDelegate.state(proposalId)
      state.should.be.eq.BN("4")
    })

    it("should show queued", async () => {
      const proposalId = await govDelegate.latestProposalIds(proposer)
      await govDelegate.queue(proposalId)
      const state = await govDelegate.state(proposalId)
      state.should.be.eq.BN("5")
    })

    it("should show executed", async () => {
      const proposalId = await govDelegate.latestProposalIds(proposer)
      await govDelegate.execute(proposalId)
      const state = await govDelegate.state(proposalId)
      state.should.be.eq.BN("7")
    })
  })


  describe("#getReceipt", () => {
    it("should work", async () => {
      const proposalId = await createProposal();
      await mineBlock();

      const receiptBefore = await govDelegate.getReceipt(proposalId, voter2)
      expect(receiptBefore.hasVoted).to.equal(false)
      await govDelegate.castVote(proposalId, 1, {from: voter2});
      const receiptAfter = await govDelegate.getReceipt(proposalId, voter2)
      expect(receiptAfter.hasVoted).to.equal(true)

      cancelProposal(proposalId)
    });
  });

  describe('castVoteBySig', () => {
    it('reverts if the signatory is invalid', async () => {
      const proposalId = await createProposal()
      await mineBlock();
      await govDelegate.castVoteBySig(proposalId, 0, 0, '0xbad', '0xbad', {from: voter2}).should.be.rejectedWith("Romulus::castVoteBySig: invalid signature");
      await cancelProposal(proposalId)
    });

    // TODO: Re-enable. Need an account with both ETH and private key
    // it('casts vote on behalf of the signatory', async () => {
    //   const Domain = {
    //     name: 'Romulus',
    //     chainId: 1, // await web3.eth.net.getId(); See: https://github.com/trufflesuite/ganache-core/issues/515
    //     verifyingContract: govDelegate.address
    //   };
    //   const Types = {
    //     Ballot: [
    //       {name: 'proposalId', type: 'uint256'},
    //       {name: 'support', type: 'uint8'},
    //     ]
    //   };

    //   await enfranchise(token, unlockedVoter.address, 1);

    //   const proposalId = await createProposal()
    //   await mineBlock();

    //   // const tx = new web3.eth.Contract(RomulusDelegate.abi, govDelegate.address).methods
    //   const {v, r, s} = EIP712.sign(Domain, 'Ballot', {proposalId, support: 1}, Types, unlockedVoter.privateKey);

    //   let beforeFors = (await govDelegate.proposals(proposalId)).forVotes;
    //   const tx = await govDelegate.castVoteBySig(proposalId, 1, v, r, s, {from: root});
    //   expect(tx.gasUsed < 80000);

    //   let afterFors = (await gov.proposals(proposalId)).forVotes;
    //   afterFors.sub(beforeFors).should.be.eq.BN(toWei("7"))

    //   await cancelProposal(proposalId)
    // });
  });
});
