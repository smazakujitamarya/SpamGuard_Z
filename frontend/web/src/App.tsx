import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface EmailData {
  id: string;
  subject: string;
  sender: string;
  encryptedSpamScore: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface SpamAnalysis {
  spamProbability: number;
  threatLevel: number;
  encryptionStrength: number;
  contentRisk: number;
  trustScore: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [emails, setEmails] = useState<EmailData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingEmail, setCreatingEmail] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newEmailData, setNewEmailData] = useState({ subject: "", sender: "", spamScore: "" });
  const [selectedEmail, setSelectedEmail] = useState<EmailData | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);
  const [userHistory, setUserHistory] = useState<string[]>([]);

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
        console.error('FHEVM initialization failed:', error);
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
      const emailsList: EmailData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          emailsList.push({
            id: businessId,
            subject: businessData.name,
            sender: businessData.description,
            encryptedSpamScore: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
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
      
      const spamScoreValue = parseInt(newEmailData.spamScore) || 0;
      const businessId = `email-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, spamScoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newEmailData.subject,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 100),
        0,
        newEmailData.sender
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, `Created email: ${newEmailData.subject}`]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Email created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewEmailData({ subject: "", sender: "", spamScore: "" });
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
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
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
      
      setUserHistory(prev => [...prev, `Decrypted email: ${businessId}`]);
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and responding!" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const analyzeSpam = (email: EmailData, decryptedScore: number | null): SpamAnalysis => {
    const spamScore = email.isVerified ? (email.decryptedValue || 0) : (decryptedScore || email.publicValue1 || 50);
    
    const spamProbability = Math.min(100, Math.max(0, spamScore));
    const threatLevel = Math.min(100, Math.round(spamScore * 1.2));
    const encryptionStrength = 100 - Math.round(spamScore * 0.3);
    const contentRisk = Math.min(95, Math.round(spamScore * 0.8));
    const trustScore = Math.max(5, 100 - spamProbability);

    return {
      spamProbability,
      threatLevel,
      encryptionStrength,
      contentRisk,
      trustScore
    };
  };

  const renderStats = () => {
    const totalEmails = emails.length;
    const verifiedEmails = emails.filter(e => e.isVerified).length;
    const avgSpamScore = emails.length > 0 
      ? emails.reduce((sum, e) => sum + e.publicValue1, 0) / emails.length 
      : 0;
    
    const highRiskEmails = emails.filter(e => e.publicValue1 > 70).length;

    return (
      <div className="stats-grid">
        <div className="stat-card gradient-card">
          <h3>Total Emails</h3>
          <div className="stat-value">{totalEmails}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
        
        <div className="stat-card gradient-card">
          <h3>Verified Data</h3>
          <div className="stat-value">{verifiedEmails}/{totalEmails}</div>
          <div className="stat-trend">On-chain Verified</div>
        </div>
        
        <div className="stat-card gradient-card">
          <h3>Avg Spam Score</h3>
          <div className="stat-value">{avgSpamScore.toFixed(1)}%</div>
          <div className="stat-trend">Encrypted Analysis</div>
        </div>
        
        <div className="stat-card gradient-card">
          <h3>High Risk</h3>
          <div className="stat-value">{highRiskEmails}</div>
          <div className="stat-trend">Require Attention</div>
        </div>
      </div>
    );
  };

  const renderSpamChart = (email: EmailData, decryptedScore: number | null) => {
    const analysis = analyzeSpam(email, decryptedScore);
    
    return (
      <div className="spam-chart">
        <div className="chart-row">
          <div className="chart-label">Spam Probability</div>
          <div className="chart-bar">
            <div 
              className="bar-fill spam" 
              style={{ width: `${analysis.spamProbability}%` }}
            >
              <span className="bar-value">{analysis.spamProbability}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Threat Level</div>
          <div className="chart-bar">
            <div 
              className="bar-fill threat" 
              style={{ width: `${analysis.threatLevel}%` }}
            >
              <span className="bar-value">{analysis.threatLevel}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Encryption Strength</div>
          <div className="chart-bar">
            <div 
              className="bar-fill encryption" 
              style={{ width: `${analysis.encryptionStrength}%` }}
            >
              <span className="bar-value">{analysis.encryptionStrength}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Content Risk</div>
          <div className="chart-bar">
            <div 
              className="bar-fill risk" 
              style={{ width: `${analysis.contentRisk}%` }}
            >
              <span className="bar-value">{analysis.contentRisk}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Trust Score</div>
          <div className="chart-bar">
            <div 
              className="bar-fill trust" 
              style={{ width: `${analysis.trustScore}%` }}
            >
              <span className="bar-value">{analysis.trustScore}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const filteredEmails = emails.filter(email => {
    const matchesSearch = email.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         email.sender.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || email.isVerified;
    return matchesSearch && matchesFilter;
  });

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>SpamGuard_Z 🔐</h1>
            <p>FHE-based Spam Filter</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🛡️</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to initialize the encrypted spam filtering system.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start analyzing emails with privacy protection</p>
              </div>
            </div>
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
        <p className="loading-note">This may take a few moments</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted spam filter...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>SpamGuard_Z 🔐</h1>
          <p>FHE-based Email Protection</p>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">
            Test Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Analyze Email
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <h2>Email Security Dashboard</h2>
          {renderStats()}
        </div>

        <div className="search-section">
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search emails..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <div className="filters">
              <label className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={filterVerified}
                  onChange={(e) => setFilterVerified(e.target.checked)}
                />
                Show Verified Only
              </label>
            </div>
          </div>
        </div>
        
        <div className="emails-section">
          <div className="section-header">
            <h2>Email Analysis Results</h2>
            <div className="header-actions">
              <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="emails-list">
            {filteredEmails.length === 0 ? (
              <div className="no-emails">
                <p>No email analysis found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Analyze First Email
                </button>
              </div>
            ) : filteredEmails.map((email, index) => (
              <div 
                className={`email-item ${selectedEmail?.id === email.id ? "selected" : ""} ${email.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedEmail(email)}
              >
                <div className="email-header">
                  <div className="email-subject">{email.subject}</div>
                  <div className="email-status">
                    {email.isVerified ? "✅ Verified" : "🔓 Pending Verification"}
                  </div>
                </div>
                <div className="email-sender">From: {email.sender}</div>
                <div className="email-meta">
                  <span>Score: {email.publicValue1}%</span>
                  <span>{new Date(email.timestamp * 1000).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {userHistory.length > 0 && (
          <div className="history-section">
            <h3>Recent Activity</h3>
            <div className="history-list">
              {userHistory.slice(-5).map((item, index) => (
                <div key={index} className="history-item">
                  {item}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreateEmail 
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
          onClose={() => { 
            setSelectedEmail(null); 
            setDecryptedData(null); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedEmail.id)}
          renderSpamChart={renderSpamChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateEmail: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  emailData: any;
  setEmailData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, emailData, setEmailData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'spamScore') {
      const intValue = value.replace(/[^\d]/g, '');
      setEmailData({ ...emailData, [name]: intValue });
    } else {
      setEmailData({ ...emailData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-email-modal">
        <div className="modal-header">
          <h2>Analyze Email with FHE</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Spam score will be encrypted with Zama FHE (Integer only)</p>
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
              name="spamScore" 
              value={emailData.spamScore} 
              onChange={handleChange} 
              placeholder="Enter spam score..." 
              min="0"
              max="100"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !emailData.subject || !emailData.sender || !emailData.spamScore} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Analyzing..." : "Analyze Email"}
          </button>
        </div>
      </div>
    </div>
  );
};

const EmailDetailModal: React.FC<{
  email: EmailData;
  onClose: () => void;
  decryptedData: number | null;
  setDecryptedData: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderSpamChart: (email: EmailData, decryptedScore: number | null) => JSX.Element;
}> = ({ email, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderSpamChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) { 
      setDecryptedData(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="email-detail-modal">
        <div className="modal-header">
          <h2>Email Analysis Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="email-info">
            <div className="info-item">
              <span>Subject:</span>
              <strong>{email.subject}</strong>
            </div>
            <div className="info-item">
              <span>Sender:</span>
              <strong>{email.sender}</strong>
            </div>
            <div className="info-item">
              <span>Date Analyzed:</span>
              <strong>{new Date(email.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Public Score:</span>
              <strong>{email.publicValue1}%</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Spam Analysis</h3>
            
            <div className="data-row">
              <div className="data-label">Spam Score:</div>
              <div className="data-value">
                {email.isVerified && email.decryptedValue ? 
                  `${email.decryptedValue}% (On-chain Verified)` : 
                  decryptedData !== null ? 
                  `${decryptedData}% (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${(email.isVerified || decryptedData !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : email.isVerified ? (
                  "✅ Verified"
                ) : decryptedData !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Decryption"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Privacy Protection</strong>
                <p>Spam score is encrypted on-chain. Click "Verify Decryption" to perform offline decryption and on-chain verification.</p>
              </div>
            </div>
          </div>
          
          {(email.isVerified || decryptedData !== null) && (
            <div className="analysis-section">
              <h3>Spam Analysis Results</h3>
              {renderSpamChart(email, email.isVerified ? email.decryptedValue || null : decryptedData)}
              
              <div className="decrypted-info">
                <div className="info-item">
                  <span>Final Spam Score:</span>
                  <strong>
                    {email.isVerified ? 
                      `${email.decryptedValue}% (Verified)` : 
                      `${decryptedData}% (Local)`
                    }
                  </strong>
                  <span className={`status-badge ${email.isVerified ? 'verified' : 'local'}`}>
                    {email.isVerified ? 'On-chain Verified' : 'Local Analysis'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!email.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying on-chain..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

