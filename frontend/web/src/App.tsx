import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface SpamEmail {
  id: string;
  subject: string;
  sender: string;
  timestamp: number;
  encryptedScore: string;
  publicValue1: number;
  publicValue2: number;
  isVerified: boolean;
  decryptedValue: number;
  creator: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [emails, setEmails] = useState<SpamEmail[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingEmail, setCreatingEmail] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newEmailData, setNewEmailData] = useState({ subject: "", sender: "", score: "" });
  const [selectedEmail, setSelectedEmail] = useState<SpamEmail | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const emailsList: SpamEmail[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          emailsList.push({
            id: businessId,
            subject: businessData.name,
            sender: businessData.creator,
            timestamp: Number(businessData.timestamp),
            encryptedScore: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            creator: businessData.creator
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setEmails(emailsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createEmail = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingEmail(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating email with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const spamScore = parseInt(newEmailData.score) || 0;
      const businessId = `email-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, spamScore);
      
      const tx = await contract.createBusinessData(
        businessId,
        newEmailData.subject,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 100),
        0,
        `Email from ${newEmailData.sender}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Email processed successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewEmailData({ subject: "", sender: "", score: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingEmail(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Spam score decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "FHE system is available and ready!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredEmails = emails.filter(email => {
    const matchesSearch = email.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         email.creator.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || email.isVerified;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: emails.length,
    verified: emails.filter(e => e.isVerified).length,
    spam: emails.filter(e => e.isVerified && e.decryptedValue > 50).length,
    recent: emails.filter(e => Date.now()/1000 - e.timestamp < 86400).length
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>SpamGuard Z 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🛡️</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access the privacy-preserving spam filter system.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading spam filter system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>SpamGuard Z 🛡️</h1>
          <span>FHE-based Privacy Protection</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            Check System
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Analyze Email
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panels">
          <div className="stat-panel">
            <h3>Total Emails</h3>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-panel">
            <h3>Verified</h3>
            <div className="stat-value">{stats.verified}</div>
          </div>
          <div className="stat-panel">
            <h3>Spam Detected</h3>
            <div className="stat-value">{stats.spam}</div>
          </div>
          <div className="stat-panel">
            <h3>Recent (24h)</h3>
            <div className="stat-value">{stats.recent}</div>
          </div>
        </div>

        <div className="search-filters">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search emails..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filters">
            <label>
              <input 
                type="checkbox" 
                checked={filterVerified}
                onChange={(e) => setFilterVerified(e.target.checked)}
              />
              Show Verified Only
            </label>
            <button onClick={loadData} className="refresh-btn">
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="emails-list">
          {filteredEmails.length === 0 ? (
            <div className="no-emails">
              <p>No emails found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Analyze First Email
              </button>
            </div>
          ) : (
            filteredEmails.map((email, index) => (
              <EmailItem 
                key={index} 
                email={email} 
                onSelect={setSelectedEmail}
                onDecrypt={decryptData}
              />
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <CreateEmailModal 
          onSubmit={createEmail} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingEmail} 
          emailData={newEmailData} 
          setEmailData={setNewEmailData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedEmail && (
        <EmailDetailModal 
          email={selectedEmail} 
          onClose={() => setSelectedEmail(null)} 
          onDecrypt={decryptData}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const EmailItem: React.FC<{ 
  email: SpamEmail; 
  onSelect: (email: SpamEmail) => void;
  onDecrypt: (id: string) => Promise<number | null>;
}> = ({ email, onSelect, onDecrypt }) => {
  const [decrypting, setDecrypting] = useState(false);

  const handleDecrypt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (email.isVerified) return;
    
    setDecrypting(true);
    try {
      await onDecrypt(email.id);
    } finally {
      setDecrypting(false);
    }
  };

  return (
    <div className="email-item" onClick={() => onSelect(email)}>
      <div className="email-header">
        <div className="email-subject">{email.subject}</div>
        <div className={`email-status ${email.isVerified ? 'verified' : 'pending'}`}>
          {email.isVerified ? '✅ Verified' : '🔒 Encrypted'}
        </div>
      </div>
      <div className="email-meta">
        <span>From: {email.creator.substring(0, 8)}...</span>
        <span>Time: {new Date(email.timestamp * 1000).toLocaleString()}</span>
      </div>
      <div className="email-actions">
        <button 
          onClick={handleDecrypt}
          disabled={decrypting || email.isVerified}
          className={`decrypt-btn ${email.isVerified ? 'verified' : ''}`}
        >
          {decrypting ? 'Decrypting...' : email.isVerified ? 'Decrypted' : 'Decrypt Score'}
        </button>
      </div>
    </div>
  );
};

const CreateEmailModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  emailData: any;
  setEmailData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, emailData, setEmailData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEmailData({ ...emailData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-email-modal">
        <div className="modal-header">
          <h2>Analyze Email with FHE</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Privacy Protection</strong>
            <p>Spam score will be encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Email Subject *</label>
            <input 
              type="text" 
              name="subject" 
              value={emailData.subject} 
              onChange={handleChange} 
              placeholder="Enter email subject..." 
            />
          </div>
          
          <div className="form-group">
            <label>Sender Address *</label>
            <input 
              type="text" 
              name="sender" 
              value={emailData.sender} 
              onChange={handleChange} 
              placeholder="Enter sender address..." 
            />
          </div>
          
          <div className="form-group">
            <label>Spam Score (0-100) *</label>
            <input 
              type="number" 
              name="score" 
              min="0" 
              max="100" 
              value={emailData.score} 
              onChange={handleChange} 
              placeholder="Enter spam score..." 
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !emailData.subject || !emailData.sender || !emailData.score} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Analyze Email"}
          </button>
        </div>
      </div>
    </div>
  );
};

const EmailDetailModal: React.FC<{
  email: SpamEmail;
  onClose: () => void;
  onDecrypt: (id: string) => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ email, onClose, onDecrypt, isDecrypting }) => {
  const [localDecrypting, setLocalDecrypting] = useState(false);

  const handleDecrypt = async () => {
    if (email.isVerified) return;
    
    setLocalDecrypting(true);
    try {
      await onDecrypt(email.id);
    } finally {
      setLocalDecrypting(false);
    }
  };

  const getSpamLevel = (score: number) => {
    if (score < 30) return { level: "Safe", color: "#10b981" };
    if (score < 70) return { level: "Suspicious", color: "#f59e0b" };
    return { level: "Spam", color: "#ef4444" };
  };

  const spamInfo = email.isVerified ? getSpamLevel(email.decryptedValue) : { level: "Unknown", color: "#6b7280" };

  return (
    <div className="modal-overlay">
      <div className="email-detail-modal">
        <div className="modal-header">
          <h2>Email Analysis Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="email-info">
            <div className="info-row">
              <span>Subject:</span>
              <strong>{email.subject}</strong>
            </div>
            <div className="info-row">
              <span>Sender:</span>
              <strong>{email.creator}</strong>
            </div>
            <div className="info-row">
              <span>Timestamp:</span>
              <strong>{new Date(email.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-row">
              <span>Spam Status:</span>
              <strong style={{ color: spamInfo.color }}>{spamInfo.level}</strong>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>FHE Encryption Status</h3>
            <div className="encryption-status">
              <div className={`status-indicator ${email.isVerified ? 'verified' : 'encrypted'}`}>
                {email.isVerified ? '🔓 Decrypted' : '🔒 Encrypted'}
              </div>
              {email.isVerified && (
                <div className="decrypted-value">
                  Spam Score: <strong>{email.decryptedValue}/100</strong>
                </div>
              )}
            </div>
            
            <div className="fhe-process">
              <div className="process-step">
                <span>1</span>
                <p>Email content encrypted with FHE</p>
              </div>
              <div className="process-step">
                <span>2</span>
                <p>AI analyzes encrypted data</p>
              </div>
              <div className="process-step">
                <span>3</span>
                <p>Result decrypted locally</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!email.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting || localDecrypting}
              className="decrypt-btn"
            >
              {isDecrypting || localDecrypting ? "Decrypting..." : "Decrypt Score"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;