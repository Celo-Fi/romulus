require('dotenv').config()
const ethers = require('ethers')
const Web3 = require('web3')
const { getCreate2Address } = require('@ethersproject/address')
const Nom = require('@nomspace/nomspace/build/contracts/Nom.json')
const { keccak256 } = require('@ethersproject/solidity')

const deployerAbi = require('./abi/deployer.abi.json')

const governanceImpl = require('../build/contracts/RomulusDelegate.json')
const governance = require('../build/contracts/RomulusDelegator.json')
const timelock = require('../build/contracts/Timelock.json')

const {
  DEPLOYER,
  SALT,
  TOKEN,
  RELEASE_TOKEN,
  TIMELOCK_NAME,
  VOTING_PERIOD,
  VOTING_DELAY,
  PROPOSAL_THRESHOLD,
  TIMELOCK_DELAY,
  PRIVATE_KEY,
  RPC_URL,
} = process.env

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const explorerMap = {
  44787: 'https://alfajores-blockscout.celo-testnet.org',
  42220: 'https://explorer.celo.org',
}
const nomMap = {
  44787: '0x36C976Da6A6499Cad683064F849afa69CD4dec2e',
  42220: '0xABf8faBbC071F320F222A526A2e1fBE26429344d',
}

function getExpectedAddress(bytecode) {
  const initHash = keccak256(['bytes'], [bytecode])
  return getCreate2Address(DEPLOYER, SALT, initHash)
}

async function main() {
  const web3 = new Web3(RPC_URL)
  const netId = await web3.eth.getChainId()
  const account = web3.eth.accounts.wallet.add(PRIVATE_KEY).address
  const deployer = new web3.eth.Contract(deployerAbi, DEPLOYER)
  const explorer = explorerMap[netId]
  const nom = new web3.eth.Contract(Nom.abi, nomMap[netId])
  const timelockName = ethers.utils.formatBytes32String(TIMELOCK_NAME)

  try {
    // Get bytecodes and expected addresses
    const implBytecode = governanceImpl.bytecode
    const implExpectedAddress = getExpectedAddress(implBytecode)

    const proxyBytecode = new ethers.ContractFactory(
      governance.abi,
      governance.bytecode,
    ).getDeployTransaction(
      timelockName,
      TOKEN,
      RELEASE_TOKEN,
      timelockName,
      implExpectedAddress,
      VOTING_PERIOD,
      VOTING_DELAY,
      PROPOSAL_THRESHOLD,
    ).data
    const proxyExpectedAddress = getExpectedAddress(proxyBytecode)

    const timelockBytecode = new ethers.ContractFactory(
      timelock.abi,
      timelock.bytecode,
    ).getDeployTransaction(proxyExpectedAddress, TIMELOCK_DELAY).data
    const timelockExpectedAddress = getExpectedAddress(timelockBytecode)

    // Reserve timelock name
    if ((await nom.methods.nameOwner(timelockName).call()) === ZERO_ADDRESS) {
      console.log(`Trying to reserve ${TIMELOCK_NAME}`)
      await nom.methods.reserve(timelockName, 31536000).send({ from: account, gasPrice: 5e8, gas: 2e7 }) // 1 year
    }
    if ((await nom.methods.resolve(timelockName).call()) !== timelockExpectedAddress) {
      console.log(`Updating resolution for ${TIMELOCK_NAME}`)
      await nom.methods
        .changeResolution(timelockName, timelockExpectedAddress)
        .send({ from: account, gasPrice: 5e8, gas: 2e7 })
    }

    // Deploy contracts
    const implDeployedBytecode = await web3.eth.getCode(implExpectedAddress)
    if (!implDeployedBytecode || implDeployedBytecode === '0x') {
      console.log(`Deploying Romulus implementation`)
      await deployer.methods.deploy(implBytecode, SALT).send({ from: account, gasPrice: 5e8, gas: 2e7 })
      console.log(`Deployed to: ${explorer}/address/${implExpectedAddress}`)
    } else {
      console.log(`Romulus implementation already deployed: ${explorer}/address/${implExpectedAddress}`)
    }

    const timelockDeployedBytecode = await web3.eth.getCode(timelockExpectedAddress)
    if (!timelockDeployedBytecode || timelockDeployedBytecode === '0x') {
      console.log(`Deploying Romulus timelock`)
      await deployer.methods.deploy(timelockBytecode, SALT).send({ from: account, gasPrice: 5e8, gas: 2e7 })
      console.log(`Deployed to: ${explorer}/address/${timelockExpectedAddress}`)
    } else {
      console.log(`Romulus timelock already deployed: ${explorer}/address/${timelockExpectedAddress}`)
    }

    const proxyDeployedBytecode = await web3.eth.getCode(proxyExpectedAddress)
    if (!proxyDeployedBytecode || proxyDeployedBytecode === '0x') {
      console.log(`Deploying Romulus proxy`)
      await deployer.methods.deploy(proxyBytecode, SALT).send({ from: account, gasPrice: 5e8, gas: 2e7 })
      console.log(`Deployed to: ${explorer}/address/${proxyExpectedAddress}`)
    } else {
      console.log(`Romulus prxoy already deployed: ${explorer}/address/${proxyExpectedAddress}`)
    }
  } catch (e) {
    console.error(e)
  }
}

main()
