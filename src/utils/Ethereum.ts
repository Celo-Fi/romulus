import ethers from 'ethers';
import Web3 from 'web3';
import {HttpProvider} from 'web3-core';

declare var web3: Web3

function encodeParameters(types: Array<string>, values: Array<string>) {
  const abi = new ethers.utils.AbiCoder();
  return abi.encode(types, values);
}

function keccak256(values: Buffer) {
  return ethers.utils.keccak256(values);
}

async function mineBlock() {
  return rpc({method: 'evm_mine'});
}

async function advanceBlocks(blocks: number) {
  const rpcs = []
  for (let i = 0; i < blocks; i++) {
    rpcs.push(mineBlock())
  }
  await Promise.all(rpcs)
}

async function rpc(request: any) {
  return new Promise((okay, fail) => {
    const currentProvider = web3.currentProvider as HttpProvider
    return currentProvider.send(request, (err: any, res: any) => err ? fail(err) : okay(res))
  })
}

export {
  encodeParameters,
  keccak256,
  advanceBlocks,
  mineBlock,
  rpc,
};
