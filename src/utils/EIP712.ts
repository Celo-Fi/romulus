// Based on https://github.com/ethereum/EIPs/blob/master/assets/eip-712/Example.js
import ethUtil from 'ethereumjs-util';
import abi from 'ethereumjs-abi';
import {Address} from '@celo/contractkit';

type Message = {
  proposalId: string,
  support: 0 | 1 | 2
}

type SignedMessage = {
  v: string,
  r: string,
  s: string,
}

type Types = Record<string, Array<{name: string, type: string}>>

// Recursively finds all the dependencies of a type
function dependencies(
  primaryType: string,
  found: Array<string> = [],
  types: Types = {},
) {
  if (found.includes(primaryType)) {
    return found;
  }
  if (types[primaryType] === undefined) {
    return found;
  }
  found.push(primaryType);
  for (let field of types[primaryType]) {
    for (let dep of dependencies(field.type, found)) {
      if (!found.includes(dep)) {
        found.push(dep);
      }
    }
  }
  return found;
}

function encodeType(primaryType: string, types: Types = {}) {
  // Get dependencies primary first, then alphabetical
  let deps = dependencies(primaryType);
  deps = deps.filter(t => t != primaryType);
  deps = [primaryType].concat(deps.sort());

  // Format as a string with fields
  let result = '';
  for (let type of deps) {
    if (!types[type])
      throw new Error(`Type '${type}' not defined in types (${JSON.stringify(types)})`);
    result += `${type}(${types[type].map(({name, type}) => `${type} ${name}`).join(',')})`;
  }
  return Buffer.from(result);
}

function typeHash(primaryType: string, types: Types = {}) {
  return ethUtil.keccak256(encodeType(primaryType, types));
}

function encodeData(
  primaryType: string,
  data: any,
  types: Types = {},
) {
  let encTypes = [];
  let encValues = [];

  // Add typehash
  encTypes.push('bytes32');
  encValues.push(typeHash(primaryType, types));

  // Add field contents
  for (let field of types[primaryType]) {
    let value = data[field.name];
    if (field.type == 'string' || field.type == 'bytes') {
      encTypes.push('bytes32');
      value = ethUtil.keccak256(Buffer.from(value));
      encValues.push(value);
    } else if (types[field.type] !== undefined) {
      encTypes.push('bytes32');
      value = ethUtil.keccak256(encodeData(field.type, value, types));
      encValues.push(value);
    } else if (field.type.lastIndexOf(']') === field.type.length - 1) {
      throw 'TODO: Arrays currently unimplemented in encodeData';
    } else {
      encTypes.push(field.type);
      encValues.push(value);
    }
  }

  return abi.rawEncode(encTypes, encValues);
}

function domainSeparator(domain: any) {
  const types = {
    EIP712Domain: [
      {name: 'name', type: 'string'},
      {name: 'version', type: 'string'},
      {name: 'chainId', type: 'uint256'},
      {name: 'verifyingContract', type: 'address'},
      {name: 'salt', type: 'bytes32'}
    ].filter(a => domain[a.name])
  };
  return ethUtil.keccak256(encodeData('EIP712Domain', domain, types));
}

function structHash(
  primaryType: string,
  data: any,
  types: Types = {},
) {
  return ethUtil.keccak256(encodeData(primaryType, data, types));
}

function digestToSign(
  domain: any,
  primaryType: string,
  message: Message,
  types: Types = {},
) {
  return ethUtil.keccak256(
    Buffer.concat([
      Buffer.from('1901', 'hex'),
      domainSeparator(domain),
      structHash(primaryType, message, types),
    ])
  );
}

function sign(
  domain: any,
  primaryType: string,
  message: Message,
  types = {},
  privateKey: string,
) {
  const digest = digestToSign(domain, primaryType, message, types);
  return {
    domain,
    primaryType,
    message,
    types,
    digest,
    ...ethUtil.ecsign(digest, ethUtil.toBuffer(privateKey)) as SignedMessage
  };
}


export default {
  encodeType,
  typeHash,
  encodeData,
  domainSeparator,
  structHash,
  digestToSign,
  sign
};
