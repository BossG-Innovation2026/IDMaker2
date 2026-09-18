/* bulk.js — Bulk Entry: passcode, Excel parse, upload orchestration */
(function() {
    'use strict';

    var PASSCODE = 'cshs305872';
    var REQUIRED_INTERNAL = ['firstName','lastName','lrn','section','photoLink'];

    // Map Excel headers → internal field names
    // Handles "Overall Student Logs" format, camelCase, and various naming conventions
    // Output-only columns (skipped) are mapped to null
    var HEADER_MAP = {
        'first name':    'firstName',
        'firstname':     'firstName',
        'middle name':   'middleName',
        'middlename':    'middleName',
        'm.i.':          null,
        'm.i':           null,
        'mi':            null,
        'last name':     'lastName',
        'lastname':      'lastName',
        'surname':       'lastName',
        'sex':           'sex',
        'gender':        'sex',
        'birthday':      'birthday',
        'birthdate':     'birthday',
        'birth date':    'birthday',
        'date of birth': 'birthday',
        'dob':           'birthday',
        'lrn':           'lrn',
        'learner reference number': 'lrn',
        'section':       'section',
        'class':         'section',
        'address':       'address',
        'full address':  'address',
        'parent/guardian': 'parentName',
        'parent':        'parentName',
        'guardian':      'parentName',
        'parentname':    'parentName',
        'contact':       'contactNumber',
        'contact number': 'contactNumber',
        'contactnumber': 'contactNumber',
        'phone':         'contactNumber',
        'photolink':     'photoLink',
        'photo link':    'photoLink',
        'photo':         'photoLink',
        'drive link':    'photoLink',
        'drivelink':     'photoLink',
        // Output-only columns — recognized but skipped
        'entry method':  null,
        'status':        null,
        'upload status': null,
        'id card link':  null,
        'created':       null,
        'updated':       null,
        'overridden':    null
    };

    var bulkRows = [];
    var bulkRunning = false;

    // ── Passcode ──────────────────────────────────────────────────
    window.closePasscodeModal = function() {
        document.getElementById('passcodeModal').classList.add('hidden');
    };

    window.submitPasscode = function() {
        var val = document.getElementById('passcodeInput').value;
        if (val === PASSCODE) {
            closePasscodeModal();
            showBulkPage();
        } else {
            document.getElementById('passcodeError').classList.remove('hidden');
            document.getElementById('passcodeInput').value = '';
            document.getElementById('passcodeInput').focus();
        }
    };

    document.getElementById('passcodeInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') window.submitPasscode();
    });

    function showBulkPage() {
        window.showPage('bulkPage');
        resetBulk();
    }

    // ── Map Excel headers to internal names ───────────────────────
    function mapHeaders(headers) {
        var mapping = {};
        headers.forEach(function(h) {
            var key = h.trim().toLowerCase();
            var internal = HEADER_MAP[key];
            if (internal) {
                mapping[h.trim()] = internal;
            }
        });
        return mapping;
    }

    // ── File handling ─────────────────────────────────────────────
    var dropzone = document.getElementById('bulkDropzone');
    var fileInput = document.getElementById('bulkFileInput');

    dropzone.addEventListener('dragover', function(e) {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', function() {
        dropzone.classList.remove('dragover');
    });
    dropzone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        var file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });
    fileInput.addEventListener('change', function(e) {
        if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    function handleFile(file) {
        var ext = file.name.split('.').pop().toLowerCase();
        if (!['xlsx','xls','csv'].includes(ext)) {
            alert('Please upload an Excel (.xlsx, .xls) or CSV file.');
            return;
        }

        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var data = new Uint8Array(e.target.result);
                var workbook = XLSX.read(data, { type: 'array' });
                var sheetName = workbook.SheetNames[0];
                var sheet = workbook.Sheets[sheetName];
                var json = XLSX.utils.sheet_to_json(sheet, { defval: '' });

                if (json.length === 0) {
                    alert('The Excel file is empty.');
                    return;
                }

                // Map headers from Excel → internal field names
                var rawHeaders = Object.keys(json[0]);
                var headerMap = mapHeaders(rawHeaders);

                // Check that required fields are mappable
                var mappedValues = Object.values(headerMap);
                var missing = REQUIRED_INTERNAL.filter(function(c) {
                    return !mappedValues.includes(c);
                });
                if (missing.length > 0) {
                    alert('Could not find columns for: ' + missing.join(', ') +
                        '\n\nExpected columns (matching Overall Student Logs format):\n' +
                        'LRN, Last Name, First Name, Middle Name, Sex, Section,\n' +
                        'Birthday, Address, Parent/Guardian, Contact, Photo Link');
                    bulkRows = [];
                    return;
                }

                // Normalize each row
                bulkRows = json.map(function(row) {
                    var normalized = {};
                    Object.keys(row).forEach(function(k) {
                        var internal = headerMap[k.trim()];
                        if (internal) {
                            normalized[internal] = String(row[k]).trim();
                        }
                    });
                    return normalized;
                });

                // Filter out rows with no firstName or lastName (header rows, blank rows)
                bulkRows = bulkRows.filter(function(r) {
                    return r.firstName && r.lastName;
                });

                if (bulkRows.length === 0) {
                    alert('No valid student rows found in the file.');
                    return;
                }

                // Show file info and preview
                document.getElementById('bulkFileInfo').classList.remove('hidden');
                document.getElementById('bulkFileInfo').innerHTML =
                    '<span class="file-name">' + file.name + '</span> — ' +
                    '<span class="file-count">' + bulkRows.length + ' students</span> detected';

                showPreview();
            } catch (err) {
                alert('Error reading Excel file: ' + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function showPreview() {
        var preview = document.getElementById('bulkPreview');
        preview.classList.remove('hidden');
        document.getElementById('bulkRowCount').textContent = bulkRows.length;

        var head = document.getElementById('bulkPreviewHead');
        var body = document.getElementById('bulkPreviewBody');
        head.innerHTML = '';
        body.innerHTML = '';

        var cols = ['firstName','lastName','section','lrn','photoLink'];
        var labels = ['First Name','Last Name','Section','LRN','Photo Link'];
        labels.forEach(function(lbl) {
            var th = document.createElement('th');
            th.textContent = lbl;
            head.appendChild(th);
        });

        var showRows = bulkRows.slice(0, 10);
        showRows.forEach(function(row) {
            var tr = document.createElement('tr');
            cols.forEach(function(c) {
                var td = document.createElement('td');
                var val = row[c] || '';
                if (c === 'photoLink' && val.length > 30) val = val.substring(0, 30) + '...';
                td.textContent = val;
                tr.appendChild(td);
            });
            body.appendChild(tr);
        });

        if (bulkRows.length > 10) {
            var tr = document.createElement('tr');
            var td = document.createElement('td');
            td.colSpan = cols.length;
            td.style.textAlign = 'center';
            td.style.color = 'var(--text-light)';
            td.textContent = '... and ' + (bulkRows.length - 10) + ' more rows';
            tr.appendChild(td);
            body.appendChild(tr);
        }
    }

    // ── Reset ─────────────────────────────────────────────────────
    window.resetBulk = function() {
        bulkRows = [];
        bulkRunning = false;
        document.getElementById('bulkFileInfo').classList.add('hidden');
        document.getElementById('bulkPreview').classList.add('hidden');
        document.getElementById('bulkProgress').classList.add('hidden');
        document.getElementById('bulkResults').classList.add('hidden');
        document.getElementById('bulkDropzone').classList.remove('hidden');
        fileInput.value = '';
    };

    // ── Bulk upload ───────────────────────────────────────────────
    window.startBulkUpload = async function() {
        if (bulkRunning || bulkRows.length === 0) return;
        bulkRunning = true;

        document.getElementById('bulkPreview').classList.add('hidden');
        document.getElementById('bulkDropzone').classList.add('hidden');
        document.getElementById('bulkFileInfo').classList.add('hidden');
        document.getElementById('bulkProgress').classList.remove('hidden');
        document.getElementById('bulkResults').classList.add('hidden');

        var total = bulkRows.length;
        var success = 0;
        var failed = 0;
        var results = [];

        for (var i = 0; i < total; i++) {
            var row = bulkRows[i];
            var name = (row.lastName || '') + ', ' + (row.firstName || '');
            var status = 'pending';
            var error = '';

            try {
                if (!row.firstName || !row.lastName || !row.lrn || !row.section || !row.photoLink) {
                    throw new Error('Missing required field');
                }

                var payload = {
                    firstName: row.firstName.toUpperCase(),
                    middleName: (row.middleName || '').toUpperCase(),
                    lastName: row.lastName.toUpperCase(),
                    sex: row.sex || '',
                    birthday: row.birthday || '',
                    lrn: row.lrn,
                    section: row.section,
                    address: row.address || '',
                    parentName: (row.parentName || '').toUpperCase(),
                    contactNumber: row.contactNumber || '',
                    photoLink: row.photoLink
                };

                var res = await fetch('/api/bulk-students', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                var data = await res.json();

                if (res.ok && data.success) {
                    status = 'done';
                    success++;
                } else if (res.status === 409 && data.duplicate) {
                    status = 'duplicate';
                    error = 'Duplicate LRN';
                    failed++;
                } else {
                    throw new Error(data.error || 'Unknown error');
                }
            } catch (err) {
                status = 'failed';
                error = err.message || 'Error';
                failed++;
            }

            results.push({ index: i + 1, name: name, section: row.section || '', status: status, error: error });

            var pct = Math.round(((i + 1) / total) * 100);
            document.getElementById('bulkProgressBar').style.width = pct + '%';
            document.getElementById('bulkProgressText').textContent = (i + 1) + ' / ' + total;
            document.getElementById('bulkProgressPercent').textContent = pct + '%';
            document.getElementById('bulkSuccessCount').textContent = success;
            document.getElementById('bulkFailCount').textContent = failed;
        }

        document.getElementById('bulkProgress').classList.add('hidden');
        document.getElementById('bulkResults').classList.remove('hidden');

        var tbody = document.getElementById('bulkResultsBody');
        tbody.innerHTML = '';
        results.forEach(function(r) {
            var tr = document.createElement('tr');
            var statusClass = r.status === 'done' ? 'status-ok' : 'status-fail';
            var statusText = r.status === 'done' ? '✓ Done' : (r.status === 'duplicate' ? '⚠ Duplicate' : '✕ Failed');
            tr.innerHTML =
                '<td>' + r.index + '</td>' +
                '<td>' + r.name + '</td>' +
                '<td>' + r.section + '</td>' +
                '<td class="' + statusClass + '">' + statusText + '</td>' +
                '<td style="color:#e53e3e;font-size:0.75rem">' + r.error + '</td>';
            tbody.appendChild(tr);
        });

        bulkRunning = false;
    };
})();
