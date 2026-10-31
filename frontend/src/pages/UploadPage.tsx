import { useState, useRef } from 'react';

export function UploadPage() {
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    queueId?: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (file: File) => {
    if (file.type !== 'application/pdf') {
      setResult({ success: false, message: 'Only PDF files are allowed' });
      return;
    }

    setUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setResult({
          success: true,
          message: `File "${file.name}" uploaded successfully!`,
          queueId: data.queueId,
        });
      } else {
        setResult({
          success: false,
          message: data.error || 'Upload failed',
        });
      }
    } catch (err) {
      setResult({
        success: false,
        message: 'Network error - please try again',
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="page">

      <h1 className="page-title">Upload Document</h1>
      <div>
        <div
          className={`upload-zone ${dragActive ? 'active' : ''} ${uploading ? 'uploading' : ''}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleChange}
            style={{ display: 'none' }}
          />

          {uploading ? (
            <div className="upload-status">
              <div className="spinner"></div>
              <p>Uploading...</p>
            </div>
          ) : (
            <div className="upload-prompt">
              <div className="upload-icon">PDF</div>
              <p>
                <strong>Drop a PDF here</strong>
                <br />
                or click to select a file
              </p>
            </div>
          )}
        </div>

        {result && (
          <div className={`upload-result ${result.success ? 'success' : 'error'}`}>
            <p>{result.message}</p>
            {result.queueId && (
              <p className="queue-info">
                Queued for processing (ID: {result.queueId})
              </p>
            )}
            {result.success && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setResult(null);
                  fileInputRef.current?.click();
                }}
              >
                Upload Another
              </button>
            )}
          </div>
        )}

        <div className="upload-info">
          <h3>How it works</h3>
          <ol>
            <li>Upload a PDF document</li>
            <li>The document is queued for AI classification</li>
            <li>Once processed, it will be filed automatically</li>
            <li>Low-confidence documents go to the review queue</li>
          </ol>
        </div>
      </div>

      <style>{`
        .upload-zone {
          border: 2px dashed #ddd;
          border-radius: 12px;
          padding: 60px 40px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          background: white;
          margin-bottom: 20px;
        }

        .upload-zone:hover,
        .upload-zone.active {
          border-color: #3498db;
          background: #f0f7ff;
        }

        .upload-zone.uploading {
          pointer-events: none;
          opacity: 0.7;
        }

        .upload-icon {
          width: 80px;
          height: 80px;
          background: #e74c3c;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 1.2rem;
          margin: 0 auto 20px;
        }

        .upload-prompt p {
          color: #666;
          margin: 0;
        }

        .upload-status {
          color: #3498db;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid #eee;
          border-top-color: #3498db;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 15px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .upload-result {
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
          text-align: center;
        }

        .upload-result.success {
          background: #d4edda;
          color: #155724;
        }

        .upload-result.error {
          background: #f8d7da;
          color: #721c24;
        }

        .queue-info {
          font-size: 0.9rem;
          opacity: 0.8;
          margin-top: 5px;
        }

        .upload-info {
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .upload-info h3 {
          margin-bottom: 15px;
          color: #2c3e50;
        }

        .upload-info ol {
          margin: 0;
          padding-left: 20px;
          color: #666;
        }

        .upload-info li {
          margin-bottom: 8px;
        }
      `}</style>
    </div>
  );
}
