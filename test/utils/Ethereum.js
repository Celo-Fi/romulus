"use strict";

const BigNumber = require('bignumber.js');
const ethers = require('ethers');
const bip39 = require('bip39');
const {hdkey} = require('ethereumjs-wallet');


function UInt256Max() {
  return ethers.constants.MaxUint256;
}

function address(n) {
  return `0x${n.toString(16).padStart(40, '0')}`;
}

function encodeParameters(types, values) {
  const abi = new ethers.utils.AbiCoder();
  return abi.encode(types, values);
}

async function etherBalance(addr) {
  return new BigNumber(await web3.eth.getBalance(addr));
}

async function etherGasCost(receipt) {
  const tx = await web3.eth.getTransaction(receipt.transactionHash);
  const gasUsed = new BigNumber(receipt.gasUsed);
  const gasPrice = new BigNumber(tx.gasPrice);
  return gasUsed.times(gasPrice);
}

function etherExp(num) {return etherMantissa(num, 1e18)}
function etherDouble(num) {return etherMantissa(num, 1e36)}
function etherMantissa(num, scale = 1e18) {
  if (num < 0)
    return new BigNumber(2).pow(256).plus(num);
  return new BigNumber(num).times(scale);
}

function etherUnsigned(num) {
  return new BigNumber(num);
}

function mergeInterface(into, from) {
  const key = (item) => item.inputs ? `${item.name}/${item.inputs.length}` : item.name;
  const existing = into.options.jsonInterface.reduce((acc, item) => {
    acc[key(item)] = true;
    return acc;
  }, {});
  const extended = from.options.jsonInterface.reduce((acc, item) => {
    if (!(key(item) in existing))
      acc.push(item)
    return acc;
  }, into.options.jsonInterface.slice());
  into.options.jsonInterface = into.options.jsonInterface.concat(from.options.jsonInterface);
  return into;
}

function getContractDefaults() {
  return {gas: 20000000, gasPrice: 20000};
}

function keccak256(values) {
  return ethers.utils.keccak256(values);
}

async function mineBlockNumber(blockNumber) {
  return rpc({method: 'evm_mineBlockNumber', params: [blockNumber]});
}

async function mineBlock() {
  return rpc({method: 'evm_mine'});
}

async function increaseTime(seconds) {
  await rpc({method: 'evm_increaseTime', params: [seconds]});
  return rpc({method: 'evm_mine'});
}

async function setTime(seconds) {
  await rpc({method: 'evm_setTime', params: [new Date(seconds * 1000)]});
}

async function freezeTime(seconds) {
  await rpc({method: 'evm_freezeTime', params: [seconds]});
  return rpc({method: 'evm_mine'});
}

async function advanceBlocks(blocks) {
  const rpcs = []
  for (let i = 0; i < blocks; i++) {
    rpcs.push(mineBlock())
  }
  await Promise.all(rpcs)
}

async function blockNumber() {
  let {result: num} = await rpc({method: 'eth_blockNumber'});
  return parseInt(num);
}

async function minerStart() {
  return rpc({method: 'miner_start'});
}

async function minerStop() {
  return rpc({method: 'miner_stop'});
}

async function rpc(request) {
  return new Promise((okay, fail) => web3.currentProvider.send(request, (err, res) => err ? fail(err) : okay(res)));
}

async function both(contract, method, args = [], opts = {}) {
  const reply = await call(contract, method, args, opts);
  const receipt = await send(contract, method, args, opts);
  return {reply, receipt};
}

async function sendFallback(contract, opts = {}) {
  const receipt = await web3.eth.sendTransaction({to: contract._address, ...Object.assign(getContractDefaults(), opts)});
  return Object.assign(receipt, {events: receipt.logs});
}

async function getUnlockedAccount(index = 0) {
  const mnemonic = 'foot negative cheap drum gate system banner region transfer autumn atom praise home must bird offer vague april deer raven lift resource crawl wisdom'
  const seed = await bip39.mnemonicToSeed(mnemonic); // mnemonic is the string containing the words
  const hdk = hdkey.fromMasterSeed(seed);
  const addressNode = hdk.derivePath(`m/44'/60'/0'/0/${index}`);
  const address = addressNode.getWallet().getAddressString(); //check that this is the same with the address that ganache list for the first account to make sure the derivation is correct
  const privateKey = web3.utils.toHex(addressNode.getWallet().getPrivateKey());
  web3.eth.accounts.wallet.add(privateKey)
  return {address, privateKey}
}

async function takeSnapshot() {
  return rpc({method: 'evm_snapshot'});
}

async function revertSnapshot(id) {
  return rpc({method: 'evm_revert', params: [id]});
}

module.exports = {
  address,
  encodeParameters,
  etherBalance,
  etherGasCost,
  etherExp,
  etherDouble,
  etherMantissa,
  etherUnsigned,
  mergeInterface,
  keccak256,
  getUnlockedAccount,

  advanceBlocks,
  blockNumber,
  freezeTime,
  increaseTime,
  mineBlock,
  mineBlockNumber,
  minerStart,
  minerStop,
  rpc,
  setTime,

  both,
  sendFallback,
  UInt256Max,

  takeSnapshot,
  revertSnapshot
};
