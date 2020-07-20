const promisify = require("util").promisify;
const Web3 = require("web3");
const { sprintf } = require("sprintf-js");
const program = require("commander");
const PrivateKeyProvider = require("truffle-privatekey-provider");
const { loadTruffleContract } = require("./lib/utils");
const { getConfig } = require('./config.js');
const { padLeft, BN } = require('web3-utils');

// network parameters
const defaultParameters = [];
const defaultProviderUrl = "http://localhost:8545";
const defaultWeiAmount = 0;
const defaultGasLimit = 4500000;
const defaultGasPrice = 20e9;
const defaultNonce = null;

program
  .option("-f, --function-name [value]", "required. function to call")
  .option("-i, --network-id [value]", "required for infura. ethereum network id. 1 for mainsale, 3 for rinkeby.")
  .option("-p, --parameters [value]>", `arguments for function split by comma. default ${ defaultParameters }`, parseParams)
  .option("-I, --infura", "whether use infura network. this option override provider url. default false")
  .option("-A, --infura-access-token [accessToken]", "access token for infura node. default emptyString")
  .option("-l, --provider-url [url]", `web3 provider url. default ${ defaultProviderUrl }`)
  .option("-w, --wei-amount [value]", `ether to transfer in wei. default ${ defaultWeiAmount }`)
  .option("-L, --gas-limit [value]", `gas limit for transaction. default ${ defaultGasLimit }`)
  .option("-P, --gas-price [value]", `gas price for transaction. default ${ defaultGasPrice }`)
  .option("-N, --nonce [value]", `nonce for transaction. default ${ defaultNonce }`)
  .option("-v, --verbose", "show debug logging")
  .parse(process.argv);

require("dotenv").config();

async function main() {
  const {
    functionName,
    networkId = null,
    infura = false,
    infuraAccessToken = "",
    gasLimit = defaultGasLimit,
    gasPrice = defaultGasPrice,
    nonce = defaultNonce,
    weiAmount = defaultWeiAmount,
    parameters,
    verbose = false,
  } = program;

  if (!functionName) throw new Error("Function name must be specified.");
  if (infura && !networkId) throw new Error("Network identifier must be specified to use infura.");

  const providerUrl = infura ? getInfuraProviderUrl(networkId, infuraAccessToken) : (program.providerUrl || defaultProviderUrl);

  const logger = Logger(verbose);
  const privatekey = "<insert private key>";
  const { web3, from } = loadWeb3FromMnemonic(providerUrl, privatekey);

  logger("network id", networkId);
  logger("provider url", providerUrl);
  logger("from", from);
  logger("function name", functionName);
  // logger("parameters", parameters.join(", "));
  logger("wei amount", weiAmount);
  logger("gas limit", gasLimit);
  logger("gas price", gasPrice);
  logger("nonce", nonce);

  if (functionName === 'approveAndCall') {
    const contractAddress = getConfig().contractAddress.managers.TON;
    const contract = await loadContract(web3, 'TON', contractAddress)
    const wton = getConfig().contractAddress.managers.WTON;

    const txObject = {
      from,
      value: weiAmount,
      gas: gasLimit,
      gasPrice,
    };

    if (nonce) {
      txObject.nonce = nonce;
    }
    const param = new BN(parameters[0]).toString();

    return contract[ functionName ](...[ wton, param, getData(),
      txObject ]).then(JSON.stringify)
      .then(console.log)
      .catch(console.error);
  } else if (functionName === 'requestWithdrawal') {
    const contractAddress = getConfig().contractAddress.managers.DepositManager;
    const contract = await loadContract(web3, 'DepositManager', contractAddress);
    const rootchain = await getConfig().contractAddress.rootchain;
    const txObject = {
      from,
      value: weiAmount,
      gas: gasLimit,
      gasPrice,
    };

    if (nonce) {
      txObject.nonce = nonce;
    }
    const param = new BN(parameters[0]).toString();

    return contract[ functionName ](...[ rootchain, param,
      txObject ]).then(JSON.stringify)
      .then(console.log)
      .catch(console.error);
  } else if (functionName === 'commit') {
    const contractAddress = getConfig().contractAddress.rootchain;
    const contract = await loadContract(web3, 'RootChain', contractAddress);

    const costNRB = await contract.COST_NRB();
    const NRELength = await contract.NRELength();
    const currentForkNumber = await contract.currentFork();

    const fork = await contract.forks(currentForkNumber);
    const epochNumber = parseInt(fork.lastEpoch) + 1;
    const startBlockNumber = parseInt(fork.lastBlock) + 1;
    const endBlockNumber = parseInt(startBlockNumber) + parseInt(NRELength) - 1;

    const pos1 = makePos(currentForkNumber, epochNumber);
    const pos2 = makePos(startBlockNumber, endBlockNumber);
    const dummyBytes = '0xdb431b544b2f5468e3f771d7843d9c5df3b4edcf8bc1c599f18f0b4ea8709bc3';

    return contract.submitNRE(pos1, pos2, dummyBytes, dummyBytes, dummyBytes, {from: from, value: costNRB}).then(JSON.stringify)
    .then(console.log)
    .catch(console.error);
  }
}

main()
  .catch(console.error);

function makePos (v1, v2) {
  v1 = new BN(v1);
  v2 = new BN(v2);

  const a = v1.mul(new BN(2).pow(new BN(128)));
  return a.add(v2).toString();
}

function parseParams(args = "") {
  if (!args) return defaultParameters;
  return args.trim().split(",")
    .map(_ => _.trim())
    .map(v => (v === "true" ? true : v === "false" ? false : v)); // parse boolean value
}

function Logger(verbose) {
  const _2Format = "%20s\t%s";

  function log2(...args) {
    if (verbose) console.log(sprintf(_2Format, ...args));
  }

  return function (...args) {
    if (args.length === 2) return log2(...args);
  };
}

function marshalString (str) {
  if (str.slice(0, 2) === '0x') return str;
  return '0x'.concat(str);
}

function getData () {
  const data = marshalString(
    [getConfig().contractAddress.managers.DepositManager, getConfig().contractAddress.rootchain]
      .map(function (value, index) {
        if (value.slice(0, 2) === '0x') return value.slice(2);
        return value;
      })
      .map(str => padLeft(str, 64))
      .join('')
  );
  return data;
}

function getInfuraProviderUrl(networkId, infuraAccessToken) {
  const baseUrl = networkId === "1" ? infuraMainnetUrl : networkId === "3" ? infuraRinkebyUrl : "";

  if (!baseUrl) throw new Error(`Couldn't specify network id ${ networkId }`);

  return infuraAccessToken ? `${ baseUrl }/${ infuraAccessToken }` : baseUrl;
}

function loadContract(web3, contractName, contractAddress) {
  if (contractName === 'RootChain') {
    return loadTruffleContract(require('./contracts/RootChain.json'), web3.currentProvider, contractAddress);
  } else if (contractName === 'DepositManager') {
    return loadTruffleContract(require('./contracts/DepositManager.json'), web3.currentProvider, contractAddress);
  } else if (contractName === 'TON') {
    return loadTruffleContract(require('./contracts/TON.json'), web3.currentProvider, contractAddress);
  }

  throw new Error(`Unspecified contract name ${ contractName }`);
}

function loadWeb3FromMnemonic(providerUrl, privatekey) {
  const web3 = new Web3();
  const provider = new PrivateKeyProvider(privatekey, providerUrl);
  web3.setProvider(provider);

  const from = provider.address;
  return { web3, from };
}