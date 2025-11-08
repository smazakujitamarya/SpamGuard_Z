pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedSpamFilter is ZamaEthereumConfig {
    struct EmailData {
        euint32 encryptedContent;
        uint256 publicMetadata;
        address sender;
        uint256 timestamp;
        bool isSpam;
        uint32 decryptedScore;
        bool isVerified;
    }

    mapping(string => EmailData) public emailRegistry;
    string[] public emailIds;

    event EmailProcessed(string indexed emailId, address indexed sender);
    event SpamVerification(string indexed emailId, bool isSpam, uint32 decryptedScore);

    constructor() ZamaEthereumConfig() {
    }

    function processEmail(
        string calldata emailId,
        externalEuint32 encryptedContent,
        bytes calldata contentProof,
        uint256 publicMetadata
    ) external {
        require(bytes(emailRegistry[emailId].sender).length == 0, "Email already processed");

        require(FHE.isInitialized(FHE.fromExternal(encryptedContent, contentProof)), "Invalid encrypted content");

        emailRegistry[emailId] = EmailData({
            encryptedContent: FHE.fromExternal(encryptedContent, contentProof),
            publicMetadata: publicMetadata,
            sender: msg.sender,
            timestamp: block.timestamp,
            isSpam: false,
            decryptedScore: 0,
            isVerified: false
        });

        FHE.allowThis(emailRegistry[emailId].encryptedContent);
        FHE.makePubliclyDecryptable(emailRegistry[emailId].encryptedContent);

        emailIds.push(emailId);

        emit EmailProcessed(emailId, msg.sender);
    }

    function verifySpamStatus(
        string calldata emailId,
        bytes memory abiEncodedResult,
        bytes memory verificationProof
    ) external {
        require(bytes(emailRegistry[emailId].sender).length > 0, "Email does not exist");
        require(!emailRegistry[emailId].isVerified, "Email already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(emailRegistry[emailId].encryptedContent);

        FHE.checkSignatures(cts, abiEncodedResult, verificationProof);

        (bool isSpam, uint32 score) = abi.decode(abiEncodedResult, (bool, uint32));

        emailRegistry[emailId].isSpam = isSpam;
        emailRegistry[emailId].decryptedScore = score;
        emailRegistry[emailId].isVerified = true;

        emit SpamVerification(emailId, isSpam, score);
    }

    function getEncryptedContent(string calldata emailId) external view returns (euint32) {
        require(bytes(emailRegistry[emailId].sender).length > 0, "Email does not exist");
        return emailRegistry[emailId].encryptedContent;
    }

    function getEmailData(string calldata emailId) external view returns (
        uint256 publicMetadata,
        address sender,
        uint256 timestamp,
        bool isSpam,
        uint32 decryptedScore,
        bool isVerified
    ) {
        require(bytes(emailRegistry[emailId].sender).length > 0, "Email does not exist");
        EmailData storage data = emailRegistry[emailId];

        return (
            data.publicMetadata,
            data.sender,
            data.timestamp,
            data.isSpam,
            data.decryptedScore,
            data.isVerified
        );
    }

    function getAllEmailIds() external view returns (string[] memory) {
        return emailIds;
    }

    function serviceStatus() public pure returns (bool operational) {
        return true;
    }
}

