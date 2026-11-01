import { useState } from 'react';

interface Document {
  id: number;
  category: string;
  document_type: string | null;
  date: string | null;
  year: string | null;
  client: string | null;
  project_number: string | null;
  person: string | null;
  institution: string | null;
  provider: string | null;
  company: string | null;
  subject: string | null;
  summary: string | null;
}

interface MetadataEditorProps {
  document: Document;
  onSave: (updates: Partial<Document>) => Promise<void>;
  onCancel: () => void;
}

const CATEGORIES = [
  'tax_form',
  'bank_statement',
  'insurance_document',
  'bill_invoice',
  'medical_record',
  'legal_contract',
  'correspondence',
  'education',
  'other',
];

export function MetadataEditor({ document, onSave, onCancel }: MetadataEditorProps) {
  const [form, setForm] = useState({
    category: document.category || '',
    document_type: document.document_type || '',
    date: document.date || '',
    year: document.year || '',
    client: document.client || '',
    project_number: document.project_number || '',
    person: document.person || '',
    institution: document.institution || '',
    provider: document.provider || '',
    company: document.company || '',
    subject: document.subject || '',
    summary: document.summary || '',
  });
  const [saving, setSaving] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="metadata-editor" onSubmit={handleSubmit}>
      <div className="editor-grid">
        <div className="field">
          <label>Category</label>
          <select name="category" value={form.category} onChange={handleChange}>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Document Type</label>
          <input
            type="text"
            name="document_type"
            value={form.document_type}
            onChange={handleChange}
            placeholder="e.g., Project Report, 1099-MISC"
          />
        </div>

        <div className="field">
          <label>Date</label>
          <input
            type="text"
            name="date"
            value={form.date}
            onChange={handleChange}
            placeholder="YYYY-MM-DD"
          />
        </div>

        <div className="field">
          <label>Year</label>
          <input
            type="text"
            name="year"
            value={form.year}
            onChange={handleChange}
            placeholder="YYYY"
          />
        </div>

        <div className="field">
          <label>Client</label>
          <input
            type="text"
            name="client"
            value={form.client}
            onChange={handleChange}
          />
        </div>

        <div className="field">
          <label>Project Number</label>
          <input
            type="text"
            name="project_number"
            value={form.project_number}
            onChange={handleChange}
          />
        </div>

        <div className="field">
          <label>Person</label>
          <input
            type="text"
            name="person"
            value={form.person}
            onChange={handleChange}
          />
        </div>

        <div className="field">
          <label>Institution</label>
          <input
            type="text"
            name="institution"
            value={form.institution}
            onChange={handleChange}
          />
        </div>

        <div className="field">
          <label>Provider</label>
          <input
            type="text"
            name="provider"
            value={form.provider}
            onChange={handleChange}
          />
        </div>

        <div className="field">
          <label>Company</label>
          <input
            type="text"
            name="company"
            value={form.company}
            onChange={handleChange}
          />
        </div>

        <div className="field full-width">
          <label>Subject</label>
          <input
            type="text"
            name="subject"
            value={form.subject}
            onChange={handleChange}
          />
        </div>

        <div className="field full-width">
          <label>Summary</label>
          <textarea
            name="summary"
            value={form.summary}
            onChange={handleChange}
            rows={3}
          />
        </div>
      </div>

      <div className="editor-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving...' : 'Save & Mark Reviewed'}
        </button>
      </div>

    </form>
  );
}
