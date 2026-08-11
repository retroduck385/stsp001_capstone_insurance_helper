import { useState, useEffect } from 'react';

/**
 * DriverLicenseEditor
 *
 * Lightweight editor focused only on Philippine driver's license fields.
 *
 * Props:
 *  - doc: { id, fileUrl, imageUrl, fileName, title, ... }
 *  - ocrData: full claim OCR items array (component filters by sourceDoc)
 *  - onClose: () => void
 *  - onSave: (payload) => void   // payload contains driver_license_* keys
 *  - runAiAnalysis: (reason) => void
 */
export default function DriverLicenseEditor({ doc, ocrData = [], onClose, onSave, runAiAnalysis }) {
  // Array.isArray guard: ocrData is a nested object in the database and is
  // flattened by services/ocrAdapter.js on the way in. This keeps the editor
  // from throwing if it is ever handed the raw shape.
  const docOcr = (Array.isArray(ocrData) ? ocrData : []).filter(f => f.sourceDoc === doc?.id);

  // Keys we expect / will save (driver_license_*)
  const fieldKeys = {
    number: 'driver_license_number',
    name: 'driver_license_name',
    dob: 'driver_license_dob',
    address: 'driver_license_address',
    class: 'driver_license_class',
    type: 'driver_license_type',
    issueDate: 'driver_license_issue_date',
    expiryDate: 'driver_license_expiry_date',
    restrictions: 'driver_license_restrictions',
    placeOfIssue: 'driver_license_place_of_issue',
    controlNo: 'driver_license_control_no',
    bloodType: 'driver_license_blood_type',
    officialReceipt: 'driver_license_official_receipt'
  };

  // Helper to find an ocr item by likely fieldId or label substring
  const findOcr = (candidates = []) => {
    for (const c of candidates) {
      const found = docOcr.find(i => (i.fieldId || '').toLowerCase() === c.toLowerCase() || (i.label || '').toLowerCase().includes(c.toLowerCase()));
      if (found) return found;
    }
    return null;
  };

  // initial values from OCR if available
  const [values, setValues] = useState({
    [fieldKeys.number]: '',
    [fieldKeys.name]: '',
    [fieldKeys.dob]: '',
    [fieldKeys.address]: '',
    [fieldKeys.class]: '',
    [fieldKeys.type]: '',
    [fieldKeys.issueDate]: '',
    [fieldKeys.expiryDate]: '',
    [fieldKeys.restrictions]: '',
    [fieldKeys.placeOfIssue]: '',
    [fieldKeys.controlNo]: '',
    [fieldKeys.bloodType]: '',
    [fieldKeys.officialReceipt]: ''
  });

  useEffect(() => {
    // best-effort mapping from common OCR fieldIds/labels into editor keys
    const mapping = [
      { keys: ['license_no', 'license_number', 'lic_no', 'license no', 'driver_license_number'], dest: fieldKeys.number },
      { keys: ['name', 'driver_name', 'name_on_license', 'license_name'], dest: fieldKeys.name },
      { keys: ['dob', 'date_of_birth', 'birthdate'], dest: fieldKeys.dob },
      { keys: ['address', 'resident', 'address_on_license'], dest: fieldKeys.address },
      { keys: ['class', 'license_class', 'lic_class'], dest: fieldKeys.class },
      { keys: ['type', 'license_type', 'professional', 'non-professional'], dest: fieldKeys.type },
      { keys: ['issue_date', 'date_of_issue', 'issued'], dest: fieldKeys.issueDate },
      { keys: ['expiry', 'expiry_date', 'valid_until', 'expiration'], dest: fieldKeys.expiryDate },
      { keys: ['restriction', 'restrictions'], dest: fieldKeys.restrictions },
      { keys: ['place_of_issue', 'lto_office', 'place'], dest: fieldKeys.placeOfIssue },
      { keys: ['control_no', 'control number', 'serial'], dest: fieldKeys.controlNo },
      { keys: ['blood_type', 'blood'], dest: fieldKeys.bloodType },
      { keys: ['official_receipt', 'or_no', 'or number', 'official receipt'], dest: fieldKeys.officialReceipt }
    ];

    const next = { ...values };
    mapping.forEach(m => {
      const found = findOcr(m.keys);
      if (found) {
        next[m.dest] = found.correctedValue ?? found.extractedValue ?? next[m.dest] ?? '';
      }
    });

    // additionally prefill name heuristically
    if (!next[fieldKeys.name]) {
      const nameHint = doc?.imageLabel || doc?.fileName || doc?.title;
      if (nameHint) next[fieldKeys.name] = nameHint.split(/[-_]/).slice(0,2).join(' ').replace(/\.[a-z]+$/i,'');
    }

    setValues(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, JSON.stringify(ocrData)]);

  const handleChange = (key, val) => setValues(prev => ({ ...prev, [key]: val }));

  const handleSave = () => {
    // validation example: license number must exist
    if (!values[fieldKeys.number]?.trim()) {
      alert('Please enter the License Number before saving.');
      return;
    }
    onSave && onSave(values);
    runAiAnalysis && runAiAnalysis(`Driver license edited for document ${doc?.fileName || doc?.id}`);
  };

  const canPreview = () => {
    const url = doc?.imageUrl || doc?.fileUrl || '';
    return /^https?:\/\//i.test(url);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Driver's License Editor</div>
          <div className="text-sm font-semibold text-slate-800">{doc?.fileName || doc?.title || 'License'}</div>
          <div className="text-[10px] text-slate-500 mt-1">Edit extracted license fields for accurate rule evaluation.</div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={onClose} className="text-xs bg-slate-100 border border-slate-200 px-2 py-1 rounded">Close</button>
        </div>
      </div>

      
        <div className="flex-1 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-600">License Number</label>
              <input type="text" value={values[fieldKeys.number]} onChange={(e) => handleChange(fieldKeys.number, e.target.value)} className="w-full border rounded px-2 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-600">License Class / Code</label>
              <input type="text" value={values[fieldKeys.class]} onChange={(e) => handleChange(fieldKeys.class, e.target.value)} className="w-full border rounded px-2 py-2 text-sm" />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-600">Name on License</label>
              <input type="text" value={values[fieldKeys.name]} onChange={(e) => handleChange(fieldKeys.name, e.target.value)} className="w-full border rounded px-2 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-600">Date of Birth</label>
              <input type="text" value={values[fieldKeys.dob]} onChange={(e) => handleChange(fieldKeys.dob, e.target.value)} placeholder="MM/DD/YYYY" className="w-full border rounded px-2 py-2 text-sm" />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-600">Issue Date</label>
              <input type="text" value={values[fieldKeys.issueDate]} onChange={(e) => handleChange(fieldKeys.issueDate, e.target.value)} placeholder="MM/DD/YYYY" className="w-full border rounded px-2 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-600">Expiry Date</label>
              <input type="text" value={values[fieldKeys.expiryDate]} onChange={(e) => handleChange(fieldKeys.expiryDate, e.target.value)} placeholder="MM/DD/YYYY" className="w-full border rounded px-2 py-2 text-sm" />
            </div>

            <div className="col-span-2">
              <label className="text-[11px] font-semibold text-slate-600">Address on License</label>
              <input type="text" value={values[fieldKeys.address]} onChange={(e) => handleChange(fieldKeys.address, e.target.value)} className="w-full border rounded px-2 py-2 text-sm" />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-600">Restrictions / Endorsements</label>
              <input type="text" value={values[fieldKeys.restrictions]} onChange={(e) => handleChange(fieldKeys.restrictions, e.target.value)} className="w-full border rounded px-2 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-600">Place of Issue (LTO)</label>
              <input type="text" value={values[fieldKeys.placeOfIssue]} onChange={(e) => handleChange(fieldKeys.placeOfIssue, e.target.value)} className="w-full border rounded px-2 py-2 text-sm" />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-600">Control / Serial No.</label>
              <input type="text" value={values[fieldKeys.controlNo]} onChange={(e) => handleChange(fieldKeys.controlNo, e.target.value)} className="w-full border rounded px-2 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-600">Blood Type</label>
              <input type="text" value={values[fieldKeys.bloodType]} onChange={(e) => handleChange(fieldKeys.bloodType, e.target.value)} className="w-full border rounded px-2 py-2 text-sm" />
            </div>

            <div className="col-span-2">
              <label className="text-[11px] font-semibold text-slate-600">Official Receipt / Payment Ref</label>
              <input type="text" value={values[fieldKeys.officialReceipt]} onChange={(e) => handleChange(fieldKeys.officialReceipt, e.target.value)} className="w-full border rounded px-2 py-2 text-sm" />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="text-xs bg-slate-100 border border-slate-200 px-3 py-2 rounded">Cancel</button>
            <button onClick={handleSave} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded font-bold">Save License</button>
          </div>
        </div>
      </div>

  );
}