import { useState, useEffect } from 'react';

/**
 * DocumentFormEditor (full version)
 *
 * - Left preview is static (no "View Full Document" button here).
 * - Fields are ordered to match the Motor Claim Form sequence to make cross-checking easy.
 * - Sections 8 and 9 are dynamic editable tables (affected persons, damage rows).
 *
 * Props:
 *   - doc: the matched document object { id, fileUrl, fileName, imageUrl, type, ... }
 *   - ocrData: array of OCR items for this claim (full claim ocrData; component filters by sourceDoc)
 *   - onClose: () => void
 *   - onSave: (updatedFields) => void   // returns an object keyed by fieldId and arrays for tables
 *   - runAiAnalysis: (reason) => void    // callback to trigger re-eval
 *
 * Save payload:
 *   - scalar fields: keys -> string
 *   - affected_persons: [{ name, age, address, injured }]
 *   - damage_rows: [{ part, description, extent }]
 */
export default function DocumentFormEditor({ doc, ocrData = [], onClose, onSave, runAiAnalysis, licenseOnly = false  }) {
  const docOcrFields = (ocrData || []).filter(f => f.sourceDoc === doc?.id);

  // Expanded & ordered list of fields mapped from the Motor Claim Form.
  const FIELD_DEFINITIONS = [
    // Section 2 — Assured's Details
    { id: 'assured_full_name', label: 'Full Name of Assured (Last, First, Middle)', section: '2. Assured’s Details' },
    { id: 'assured_dob', label: 'Date of Birth (MM/DD/YYYY)', section: '2. Assured’s Details' },
    { id: 'assured_place_of_birth', label: 'Place of Birth', section: '2. Assured’s Details' },
    { id: 'assured_sex', label: 'Sex', section: '2. Assured’s Details' },
    { id: 'assured_nationality', label: 'Nationality', section: '2. Assured’s Details' },
    { id: 'assured_id_type', label: 'Type of Valid ID', section: '2. Assured’s Details' },
    { id: 'assured_id_no', label: 'Valid ID No.', section: '2. Assured’s Details' },
    { id: 'assured_tin_sss_gsis', label: 'TIN / SSS / GSIS Number', section: '2. Assured’s Details' },
    { id: 'assured_email', label: 'Email Address', section: '2. Assured’s Details' },
    { id: 'assured_mobile', label: 'Mobile No.', section: '2. Assured’s Details' },
    { id: 'assured_home_phone', label: 'Home Phone No. (Optional)', section: '2. Assured’s Details' },
    { id: 'assured_address', label: 'Residence / Present Address', section: '2. Assured’s Details', inputType: 'textarea', rows: 3 },
    { id: 'assured_source_of_fund', label: 'Source of Fund', section: '2. Assured’s Details' },
    { id: 'assured_is_pep', label: 'Is the Assured a PEP?', section: '2. Assured’s Details' },

    // Section 3 — Insured Vehicle's Information
    { id: 'vehicle_year', label: 'Year', section: '3. Insured Vehicle’s Information' },
    { id: 'vehicle_model', label: 'Model', section: '3. Insured Vehicle’s Information' },
    { id: 'vehicle_make', label: 'Make', section: '3. Insured Vehicle’s Information' },
    { id: 'vehicle_type', label: 'Type', section: '3. Insured Vehicle’s Information' },
    { id: 'vehicle_engine_no', label: 'Engine No.', section: '3. Insured Vehicle’s Information' },
    { id: 'vehicle_registered_owner', label: 'Registered Owner (Last, First, Middle)', section: '3. Insured Vehicle’s Information' },
    { id: 'vehicle_chassis_no', label: 'Serial / Chassis No.', section: '3. Insured Vehicle’s Information' },
    { id: 'vehicle_plate_no', label: 'Plate No.', section: '3. Insured Vehicle’s Information' },

    // Section 4 — Driver's Information (if other than insured)
    { id: 'driver_full_name', label: 'Full Name of Driver', section: '4. Driver’s Information' },
    { id: 'driver_age', label: 'Age', section: '4. Driver’s Information' },
    { id: 'driver_license_type', label: 'License Type', section: '4. Driver’s Information' },
    { id: 'driver_license_no', label: 'License No.', section: '4. Driver’s Information' },
    { id: 'driver_license_expiry', label: 'License Expiry Date (MM/DD/YYYY)', section: '4. Driver’s Information' },
    { id: 'driver_address', label: 'Residence / Present Address (Driver)', section: '4. Driver’s Information', inputType: 'textarea', rows: 2 },
    { id: 'driver_is_employee', label: 'Is the Driver an Employee of the Assured?', section: '4. Driver’s Information' },
    { id: 'driver_relationship', label: 'If Yes, provide nature of relationship', section: '4. Driver’s Information' },
    { id: 'driver_authorized_by', label: 'Who authorized the driver to use the vehicle?', section: '4. Driver’s Information' },

    // Section 5 — Details of the Accident or Loss
    { id: 'accident_date', label: 'Date of Accident or Loss (MM/DD/YYYY)', section: '5. Details of the Accident or Loss' },
    { id: 'accident_time', label: 'Time of Accident or Loss (HH:MM)', section: '5. Details of the Accident or Loss' },
    { id: 'accident_weather', label: 'Weather during the Accident or Loss', section: '5. Details of the Accident or Loss' },
    { id: 'accident_place', label: 'Place of Accident or Loss', section: '5. Details of the Accident or Loss' },
    { id: 'accident_police_authority', label: 'Full Name of Police Authority (if reported)', section: '5. Details of the Accident or Loss' },
    

    // Section 6 — Additional Details
    { id: 'nature_of_business', label: 'Nature of Business', section: '6. Additional Details' },
    { id: 'purpose_of_use', label: 'Purpose of Use of the Vehicle', section: '6. Additional Details' },
    { id: 'vehicle_used_for_hire', label: 'Is the vehicle being used for hire / rent?', section: '6. Additional Details' },
    { id: 'registered_in_pami_tnvs', label: 'Is the vehicle registered in PAMI / TNVS?', section: '6. Additional Details' },
    { id: 'direction_during_accident', label: 'Direction of the vehicle during the accident', section: '6. Additional Details' },
    { id: 'speed_rate_vehicle', label: 'Speed rate of the vehicle during the accident', section: '6. Additional Details' },
    { id: 'direction_other_party', label: "Direction of other party's vehicle during the accident", section: '6. Additional Details' },
    { id: 'speed_rate_other_party', label: "Speed rate of other party's vehicle during the accident", section: '6. Additional Details' },
    { id: 'party_at_fault', label: 'Party at fault (if any)', section: '6. Additional Details' },
    { id: 'settlements_made', label: "Settlements made with other party's vehicle (if any)", section: '6. Additional Details' },

    // Section 7 — Reason for Late Filing
    { id: 'reason_for_late_filing', label: 'Reason for Late Filing', section: '7. Reason for Late Filing', inputType: 'textarea', rows: 4 },

    // Section 8 — List of Affected Persons (table handled specially)
    { id: 'affected_persons', label: 'List of Affected Persons (table)', section: '8. List of Affected Persons' },

    // Section 9 — Description of Damage/s (table handled specially)
    { id: 'description_of_damage', label: 'Description of Damage/s (table)', section: '9. Description of Damage/s' },
    { id: 'current_location_of_vehicle', label: 'Current Location of Vehicle', section: '9. Description of Damage/s' },

    // Payment & Authorization
    { id: 'payment_bank_name', label: 'Bank Name (for payout)', section: 'Payment / Authorization' },
    { id: 'payment_account_number', label: 'Account Number of Payee', section: 'Payment / Authorization' },
    { id: 'payment_account_name', label: 'Account Name of Payee', section: 'Payment / Authorization' },
    { id: 'authorization_text', label: 'Authorization / Declaration Text (short)', section: 'Payment / Authorization', inputType: 'textarea', rows: 3 }
  ];

  // Build initial scalar field state (attempt exact fieldId match; fallback heuristic)
  const buildInitialValues = () => {
    const values = {};
    FIELD_DEFINITIONS.forEach(fd => {
      const matchById = docOcrFields.find(f => f.fieldId === fd.id);
      if (matchById) {
        values[fd.id] = {
          value: matchById.correctedValue ?? matchById.extractedValue ?? '',
          suggestion: matchById.aiSuggestion ?? null,
          confidence: matchById.confidence ?? null,
          raw: matchById.extractedValue ?? ''
        };
        return;
      }
      // heuristic token match
      const token = fd.label.split(' ')[0].toLowerCase();
      const matchHeuristic = docOcrFields.find(f =>
        (f.label || '').toLowerCase().includes(token) ||
        (f.extractedValue || '').toLowerCase().includes(token)
      );
      if (matchHeuristic) {
        values[fd.id] = {
          value: matchHeuristic.correctedValue ?? matchHeuristic.extractedValue ?? '',
          suggestion: matchHeuristic.aiSuggestion ?? null,
          confidence: matchHeuristic.confidence ?? null,
          raw: matchHeuristic.extractedValue ?? ''
        };
        return;
      }
      values[fd.id] = { value: '', suggestion: null, confidence: null, raw: '' };
    });
    return values;
  };

  // scalar fields
  const [fields, setFields] = useState(buildInitialValues);
  const [analysisPending, setAnalysisPending] = useState(false);

  // dynamic tables state
  const [affectedRows, setAffectedRows] = useState([]);
  const [damageRows, setDamageRows] = useState([]);

  // initialize when doc or ocrData changes
  useEffect(() => {
    setFields(buildInitialValues());

    // initialize affectedRows from OCR if present
    const affectedField = docOcrFields.find(f => f.fieldId === 'affected_persons');
    if (affectedField && affectedField.extractedValue) {
      try {
        const parsed = JSON.parse(affectedField.correctedValue ?? affectedField.extractedValue);
        if (Array.isArray(parsed)) setAffectedRows(parsed);
        else setAffectedRows([]);
      } catch {
        const rows = (affectedField.extractedValue || '').split('\n').filter(Boolean).map(line => ({ name: line, age: '', address: '', injured: false }));
        setAffectedRows(rows.length ? rows : [{ name: '', age: '', address: '', injured: false }]);
      }
    } else {
      setAffectedRows([{ name: '', age: '', address: '', injured: false }]);
    }

    // initialize damageRows from OCR if present
    const damageField = docOcrFields.find(f => f.fieldId === 'description_of_damage');
    if (damageField && damageField.extractedValue) {
      try {
        const parsed = JSON.parse(damageField.correctedValue ?? damageField.extractedValue);
        if (Array.isArray(parsed)) setDamageRows(parsed);
        else setDamageRows([]);
      } catch {
        const blocks = (damageField.extractedValue || '').split(/\n{1,2}/).filter(Boolean);
        const rows = blocks.length ? blocks.map(b => ({ part: '', description: b, extent: '' })) : [{ part: '', description: '', extent: '' }];
        setDamageRows(rows);
      }
    } else {
      setDamageRows([{ part: '', description: '', extent: '' }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, JSON.stringify(ocrData)]);

  const handleFieldChange = (fieldId, newValue) => {
    setFields(prev => ({ ...prev, [fieldId]: { ...prev[fieldId], value: newValue } }));
  };

  const acceptSuggestion = (fieldId) => {
    const suggestion = fields[fieldId].suggestion;
    if (suggestion != null) setFields(prev => ({ ...prev, [fieldId]: { ...prev[fieldId], value: suggestion } }));
  };

  const acceptAllSuggestions = () => {
    const next = { ...fields };
    Object.keys(next).forEach(k => { if (next[k].suggestion != null) next[k].value = next[k].suggestion; });
    setFields(next);
  };

  const resetToOcr = () => {
    const next = { ...fields };
    Object.keys(next).forEach(k => { next[k].value = next[k].raw || ''; });
    setFields(next);
    setAffectedRows([{ name: '', age: '', address: '', injured: false }]);
    setDamageRows([{ part: '', description: '', extent: '' }]);
  };

  const handleAnalyze = () => {
    setAnalysisPending(true);
    setTimeout(() => {
      const next = { ...fields };
      Object.keys(next).forEach(k => {
        if (!next[k].suggestion && next[k].raw && !next[k].value) next[k].suggestion = next[k].raw;
      });
      setFields(next);
      setAnalysisPending(false);
    }, 700);
  };

  // Affected persons actions
  const addAffectedRow = () => setAffectedRows(prev => [...prev, { name: '', age: '', address: '', injured: false }]);
  const updateAffectedRow = (idx, key, val) => setAffectedRows(prev => prev.map((r, i) => i === idx ? { ...r, [key]: val } : r));
  const removeAffectedRow = (idx) => setAffectedRows(prev => prev.filter((_, i) => i !== idx));

  // Damage actions
  const addDamageRow = () => setDamageRows(prev => [...prev, { part: '', description: '', extent: '' }]);
  const updateDamageRow = (idx, key, val) => setDamageRows(prev => prev.map((r, i) => i === idx ? { ...r, [key]: val } : r));
  const removeDamageRow = (idx) => setDamageRows(prev => prev.filter((_, i) => i !== idx));

  const handleSave = () => {
    const payload = {};
    Object.keys(fields).forEach(k => { payload[k] = fields[k].value || ''; });
    payload.affected_persons = affectedRows;
    payload.damage_rows = damageRows;

    onSave && onSave(payload);
    runAiAnalysis && runAiAnalysis(`Form fields and tables edited for ${doc?.fileName || doc?.title || doc?.id}`);
  };

  // inline preview availability (prefer https/http)
  const canPreviewInline = () => {
    if (!doc) return false;
    const url = doc.imageUrl || doc.fileUrl || '';
    if (!url) return false;
    return /^https?:\/\//i.test(url);
  };

  // Build sections grouped from definitions (we'll render specially for sections 8 & 9)
  const sections = FIELD_DEFINITIONS.reduce((acc, fd) => {
    acc[fd.section] = acc[fd.section] || [];
    acc[fd.section].push(fd);
    return acc;
  }, {});

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Completed Motor Claim Form — Form Editor</div>
          <div className="text-sm font-semibold text-slate-800">{doc?.fileName || doc?.title}</div>
          <div className="text-[10px] text-slate-500 mt-1">Fields are arranged to match the original Motor Claim Form for faster cross-checking.</div>
        </div>

        <div className="flex items-center gap-2">
          <button className="text-xs bg-slate-50 border border-slate-200 text-slate-700 px-2 py-1 rounded" onClick={resetToOcr}>Reset to OCR</button>
          <button onClick={acceptAllSuggestions} className="text-xs bg-blue-50 border border-blue-100 text-blue-700 px-2 py-1 rounded">Accept All Suggestions</button>
          <button onClick={handleAnalyze} disabled={analysisPending} className="text-xs bg-amber-50 border border-amber-100 text-amber-700 px-2 py-1 rounded font-bold">
            {analysisPending ? 'Analyzing…' : 'Analyze by AI'}
          </button>
          <button onClick={onClose} className="text-xs bg-slate-100 border border-slate-200 px-2 py-1 rounded">Close</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div className="flex gap-4">
        

          {/* Right: ordered form fields & tables */}
          <div className="flex-1 space-y-3">
            {Object.keys(sections).map(sectionName => (
              <div key={sectionName} className="p-3 border border-slate-100 rounded-lg bg-white">
                <div className="mb-2">
                  <div className="text-xs font-bold text-slate-700">{sectionName}</div>
                </div>

                {/* Section 8: Affected Persons table */}
                {sectionName.includes('8. List of Affected Persons') ? (
                  <div>
                    <div className="text-[11px] text-slate-600 mb-2">Edit affected persons — add/remove rows as needed.</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600 text-[12px]">
                          <tr>
                            <th className="px-2 py-2 text-left">Name</th>
                            <th className="px-2 py-2 text-left w-20">Age</th>
                            <th className="px-2 py-2 text-left">Address</th>
                            <th className="px-2 py-2 text-center w-28">Injured</th>
                            <th className="px-2 py-2 w-24"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {affectedRows.map((r, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-2 py-2">
                                <input type="text" value={r.name} onChange={(e) => updateAffectedRow(i, 'name', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" />
                              </td>
                              <td className="px-2 py-2">
                                <input type="text" value={r.age} onChange={(e) => updateAffectedRow(i, 'age', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" />
                              </td>
                              <td className="px-2 py-2">
                                <input type="text" value={r.address} onChange={(e) => updateAffectedRow(i, 'address', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" />
                              </td>
                              <td className="px-2 py-2 text-center">
                                <input type="checkbox" checked={!!r.injured} onChange={(e) => updateAffectedRow(i, 'injured', e.target.checked)} />
                              </td>
                              <td className="px-2 py-2 text-right">
                                <button onClick={() => removeAffectedRow(i)} className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded">Remove</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-2">
                      <button onClick={addAffectedRow} className="text-xs bg-emerald-50 border border-emerald-100 text-emerald-700 px-2 py-1 rounded">+ Add Person</button>
                    </div>
                  </div>
                ) : sectionName.includes('9. Description of Damage') ? (
                  // Section 9: Damage table
                  <div>
                    <div className="text-[11px] text-slate-600 mb-2">Itemize damaged parts, description and extent.</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600 text-[12px]">
                          <tr>
                            <th className="px-2 py-2 text-left">Part/s Damaged</th>
                            <th className="px-2 py-2 text-left">Description</th>
                            <th className="px-2 py-2 text-left w-40">Extent of Damage/s</th>
                            <th className="px-2 py-2 w-24"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {damageRows.map((r, i) => (
                            <tr key={i} className="border-t align-top">
                              <td className="px-2 py-2">
                                <input type="text" value={r.part} onChange={(e) => updateDamageRow(i, 'part', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" />
                              </td>
                              <td className="px-2 py-2">
                                <textarea rows={2} value={r.description} onChange={(e) => updateDamageRow(i, 'description', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" />
                              </td>
                              <td className="px-2 py-2">
                                <input type="text" value={r.extent} onChange={(e) => updateDamageRow(i, 'extent', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" />
                              </td>
                              <td className="px-2 py-2 text-right">
                                <button onClick={() => removeDamageRow(i)} className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded">Remove</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-2">
                      <button onClick={addDamageRow} className="text-xs bg-emerald-50 border border-emerald-100 text-emerald-700 px-2 py-1 rounded">+ Add Item</button>
                    </div>
                  </div>
                ) : (
                  // Generic scalar fields in this section (exclude table-handled ids)
                  <div className="grid grid-cols-2 gap-3">
                    {sections[sectionName].filter(fd => fd.id !== 'affected_persons' && fd.id !== 'description_of_damage').map(fd => {
                      const field = fields[fd.id] || { value: '', suggestion: null, confidence: null, raw: '' };
                      const isTextarea = fd.inputType === 'textarea';
                      return (
                        <div key={fd.id} className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-600">{fd.label}</label>
                          {isTextarea ? (
                            <textarea rows={fd.rows || 3} value={field.value} onChange={(e) => handleFieldChange(fd.id, e.target.value)} className="w-full border border-slate-200 rounded px-2 py-2 text-sm" />
                          ) : (
                            <input type="text" value={field.value} onChange={(e) => handleFieldChange(fd.id, e.target.value)} className="w-full border border-slate-200 rounded px-2 py-2 text-sm" />
                          )}
                          {field.suggestion && (
                            <div className="text-[11px] text-slate-500 flex justify-between items-center">
                              <div className="truncate">{field.suggestion}</div>
                              <button onClick={() => acceptSuggestion(fd.id)} className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded">Use</button>
                            </div>
                          )}
                          {field.raw && field.raw !== field.value && <div className="text-[10px] text-slate-400 italic">OCR: {field.raw}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs bg-slate-100 border border-slate-200 px-3 py-2 rounded">Cancel</button>
          <button onClick={handleSave} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded font-bold">Save & Re-evaluate</button>
        </div>
      </div>
    </div>
  );
}