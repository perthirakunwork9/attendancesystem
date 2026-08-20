/**
 * attendance.js - Daily Attendance Check-in/out UI and Logic (Core Module)
 */

let attDate = '';
let attFilterTeam = 'all';
let attFilterStatus = 'all';
let attSearchQuery = '';
let _lastAction = null; // For Undo functionality

function renderAttendancePage() {
  const settings = SettingsDB.get();
  const teams = TeamDB.getAll();
  if (!attDate) {
    const session = SessionDB.get();
    attDate = session.attDate || DateUtils.today();
  }

  return `
  <div class="att-sticky-header" id="att-sticky-header">
    <div class="att-header-top">
      <div class="att-title-group">
        <h2 class="page-title"><i class="fa-solid fa-clipboard-check"></i> เช็คชื่อการทำงาน</h2>
        <div class="att-date-display">${DateUtils.toThaiFullDate(attDate)} (${DateUtils.getDayOfWeekTH(attDate)})</div>
      </div>
      <div class="att-header-actions">
        <input type="date" id="att-date-picker" class="date-picker" value="${attDate}" onchange="changeAttDate(this.value)" />
        ${Auth.can('check_attendance') ? `
        <button class="btn btn-success btn-batch" onclick="batchCheckAll()">
          <i class="fa-solid fa-circle-check"></i> <span>เช็คทั้งหมด</span>
        </button>` : ''}
      </div>
    </div>
    ${renderAttSummaryBar()}
    <div class="att-filters">
      <div class="search-box">
        <i class="fa-solid fa-search search-icon"></i>
        <input type="text" id="att-search" class="search-input" placeholder="ค้นหาชื่อ / รหัส..." value="${escHtml(attSearchQuery)}" oninput="filterAttendance()" />
      </div>
      <select class="filter-select" id="att-filter-team" onchange="filterAttendance()">
        <option value="all">ทุกทีม</option>
        ${teams.map(t => `<option value="${t.id}" ${attFilterTeam===t.id?'selected':''}>${escHtml(t.name)}</option>`).join('')}
      </select>
      <select class="filter-select" id="att-filter-status" onchange="filterAttendance()">
        <option value="all">ทุกสถานะ</option>
        ${StatusUtils.all().map(s => `<option value="${s}" ${attFilterStatus===s?'selected':''}>${StatusUtils.getLabel(s)}</option>`).join('')}
      </select>
    </div>
  </div>

  <div id="att-list-container" class="att-list-container">
    ${renderAttendanceList()}
  </div>

  ${renderAttDetailModal()}
  `;
}

function renderAttSummaryBar() {
  const employees = EmployeeDB.getActive();
  const records = AttendanceDB.getByDate(attDate);
  const recordMap = {};
  records.forEach(r => recordMap[r.employeeId] = r);

  let present=0, late=0, absent=0, leave=0, field=0, unchecked=0;
  employees.forEach(emp => {
    const r = recordMap[emp.id];
    const s = r ? r.status : 'unchecked';
    if (s==='present') present++;
    else if (s==='late') late++;
    else if (s==='absent') absent++;
    else if (s==='leave') leave++;
    else if (s==='field') field++;
    else unchecked++;
  });
  const total = employees.length;

  return `
  <div class="att-summary-bar">
    <div class="att-sum-item" onclick="setAttFilter('all')"><span class="att-sum-num">${total}</span><span class="att-sum-label">ทั้งหมด</span></div>
    <div class="att-sum-item status-present-light" onclick="setAttFilter('present')"><span class="att-sum-num" style="color:#10b981">${present}</span><span class="att-sum-label">มาทำงาน</span></div>
    <div class="att-sum-item status-late-light" onclick="setAttFilter('late')"><span class="att-sum-num" style="color:#f59e0b">${late}</span><span class="att-sum-label">มาสาย</span></div>
    <div class="att-sum-item status-leave-light" onclick="setAttFilter('leave')"><span class="att-sum-num" style="color:#8b5cf6">${leave}</span><span class="att-sum-label">ลางาน</span></div>
    <div class="att-sum-item status-absent-light" onclick="setAttFilter('absent')"><span class="att-sum-num" style="color:#ef4444">${absent}</span><span class="att-sum-label">ขาด</span></div>
    <div class="att-sum-item" onclick="setAttFilter('unchecked')"><span class="att-sum-num" style="color:#9ca3af">${unchecked}</span><span class="att-sum-label">ยังไม่เช็ค</span></div>
  </div>`;
}

function setAttFilter(status) {
  attFilterStatus = status;
  const el = document.getElementById('att-filter-status');
  if (el) el.value = status;
  setHtml('#att-list-container', renderAttendanceList());
  setHtml('.att-summary-bar', renderAttSummaryBar().replace('<div class="att-summary-bar">', '').replace('</div>', ''));
}

function renderAttendanceList() {
  let employees = EmployeeDB.getActive();
  const records = AttendanceDB.getByDate(attDate);
  const recordMap = {};
  records.forEach(r => recordMap[r.employeeId] = r);
  const teams = TeamDB.getAll();
  const teamMap = {};
  teams.forEach(t => teamMap[t.id] = t);

  // Apply filters
  if (attFilterTeam !== 'all') employees = employees.filter(e => e.teamId === attFilterTeam);
  if (attSearchQuery) {
    const q = attSearchQuery.toLowerCase();
    employees = employees.filter(e =>
      e.firstName.toLowerCase().includes(q) || e.lastName.toLowerCase().includes(q) ||
      (e.nickname||'').toLowerCase().includes(q) || e.id.toLowerCase().includes(q) ||
      (e.position||'').toLowerCase().includes(q)
    );
  }
  if (attFilterStatus !== 'all') {
    employees = employees.filter(e => {
      const s = (recordMap[e.id] || {}).status || 'unchecked';
      return s === attFilterStatus;
    });
  }

  if (employees.length === 0) {
    return `<div class="empty-state"><i class="fa-solid fa-magnifying-glass"></i><h3>ไม่พบรายชื่อ</h3><p>ลองเปลี่ยน Filter หรือค้นหาด้วยคำอื่น</p></div>`;
  }

  return `
  <div class="att-cards-grid">
    ${employees.map(emp => {
      const record = recordMap[emp.id] || null;
      const status = record ? record.status : 'unchecked';
      const team = teamMap[emp.teamId];
      const avatar = empAvatar(emp, 48);
      const settings = SettingsDB.get();
      const workHours = record && record.checkIn && record.checkOut
        ? DateUtils.calcWorkHours(record.checkIn, record.checkOut, settings.lunchBreakMinutes)
        : 0;

      return `
      <div class="att-card status-border-${status}" id="att-card-${emp.id}">
        <div class="att-card-top" onclick="openAttDetail('${emp.id}')">
          <img src="${avatar}" alt="${escHtml(emp.firstName)}" class="att-emp-avatar" />
          <div class="att-emp-info">
            <div class="att-emp-name">${escHtml(emp.firstName)} ${escHtml(emp.lastName)}
              ${emp.nickname ? `<span class="att-emp-nick">(${escHtml(emp.nickname)})</span>` : ''}
            </div>
            <div class="att-emp-meta">${escHtml(emp.id)} ${team ? `• <span style="color:${team.color}">${escHtml(team.name)}</span>` : ''}</div>
            <div class="att-emp-pos">${escHtml(emp.position||'-')}</div>
          </div>
          <div class="att-current-status">
            ${StatusUtils.getBadge(status)}
            ${record && record.checkIn ? `<div class="att-time-display"><i class="fa-solid fa-clock"></i> ${record.checkIn}${record.checkOut ? ' - '+record.checkOut : ''}</div>` : ''}
            ${workHours > 0 ? `<div class="att-hours-display">${fmtHours(workHours)} ชม.</div>` : ''}
          </div>
        </div>

        ${Auth.can('check_attendance') ? `
        <div class="att-status-btns">
          <button class="att-btn-status ${status==='present'?'active':''} btn-present" onclick="quickSetStatus('${emp.id}', 'present')">
            <i class="fa-solid fa-circle-check"></i> มาทำงาน
          </button>
          <button class="att-btn-status ${status==='late'?'active':''} btn-late" onclick="quickSetStatus('${emp.id}', 'late')">
            <i class="fa-solid fa-clock"></i> มาสาย
          </button>
          <button class="att-btn-status ${status==='leave'?'active':''} btn-leave" onclick="openLeaveModal('${emp.id}')">
            <i class="fa-solid fa-calendar-minus"></i> ลางาน
          </button>
          <button class="att-btn-status ${status==='absent'?'active':''} btn-absent" onclick="openAbsentModal('${emp.id}')">
            <i class="fa-solid fa-circle-xmark"></i> ขาดงาน
          </button>
          <button class="att-btn-status ${status==='field'?'active':''} btn-field" onclick="openFieldModal('${emp.id}')">
            <i class="fa-solid fa-location-dot"></i> นอกสถานที่
          </button>
        </div>` : ''}
      </div>
      `;
    }).join('')}
  </div>
  `;
}

function filterAttendance() {
  attSearchQuery = val('#att-search');
  attFilterTeam = (document.getElementById('att-filter-team')||{value:'all'}).value;
  attFilterStatus = (document.getElementById('att-filter-status')||{value:'all'}).value;
  saveAttSession();
  setHtml('#att-list-container', renderAttendanceList());
}

function changeAttDate(newDate) {
  attDate = newDate;
  saveAttSession();
  // Re-render full page to update summary bar too
  setHtml('#page-content', renderAttendancePage());
}

function saveAttSession() {
  const session = SessionDB.get();
  session.attDate = attDate;
  session.attFilterTeam = attFilterTeam;
  session.attFilterStatus = attFilterStatus;
  SessionDB.save(session);
}

// Quick status set (no modal needed)
function quickSetStatus(empId, status) {
  if (!Auth.requirePermission('check_attendance')) return;
  const emp = EmployeeDB.getById(empId);
  if (!emp) return;
  const settings = SettingsDB.get();
  const existing = AttendanceDB.getByEmployeeAndDate(empId, attDate);
  const prevStatus = existing ? existing.status : 'unchecked';

  let checkIn = (existing && existing.checkIn) || '';
  let checkOut = (existing && existing.checkOut) || '';

  // Auto-set default times for present/late
  if (status === 'present' && !checkIn) {
    checkIn = settings.defaultCheckInTime;
    checkOut = '17:30';
  } else if (status === 'late' && !checkIn) {
    checkIn = '08:15';
    checkOut = '17:30';
  }

  const record = {
    ...(existing || {}),
    id: `${empId}_${attDate}`,
    employeeId: empId,
    date: attDate,
    status,
    checkIn: (status==='absent'||status==='leave') ? '' : checkIn,
    checkOut: (status==='absent'||status==='leave') ? '' : checkOut,
    lateMinutes: status==='late' ? DateUtils.calcLateMinutes(checkIn, settings.defaultCheckInTime) : 0,
    leaveType: status==='leave' ? (existing&&existing.leaveType||'sick') : '',
    location: status==='field' ? (existing&&existing.location||'') : (existing&&existing.location||''),
    note: existing ? existing.note||'' : '',
    otHours: existing ? existing.otHours||0 : 0,
    createdBy: existing ? existing.createdBy : Auth.getUserName(),
    updatedBy: Auth.getUserName(),
  };

  AttendanceDB.save(record);

  AuditDB.add({
    action: 'SET_ATTENDANCE',
    entityType: 'attendance', entityId: `${empId}_${attDate}`,
    description: `เช็คชื่อ ${emp.firstName} ${emp.lastName}: ${StatusUtils.getLabel(prevStatus)} → ${StatusUtils.getLabel(status)}`,
    before: { status: prevStatus }, after: { status }, performedBy: Auth.getUserName(),
  });

  // Save for undo
  _lastAction = { record: existing, empId, date: attDate };

  // Update just this card + summary bar
  refreshAttCard(empId, record);
  const summaryEl = document.querySelector('.att-summary-bar');
  if (summaryEl) summaryEl.outerHTML = renderAttSummaryBar();

  showToast(
    `${emp.firstName} ${emp.lastName} — ${StatusUtils.getLabel(status)}`,
    'success',
    () => undoLastAttAction()
  );
}

function undoLastAttAction() {
  if (!_lastAction) return;
  const { record, empId, date } = _lastAction;
  if (record) {
    AttendanceDB.save(record);
  } else {
    AttendanceDB.delete(empId, date);
  }
  _lastAction = null;
  setHtml('#page-content', renderAttendancePage());
}

function refreshAttCard(empId, record) {
  const cardEl = document.getElementById(`att-card-${empId}`);
  if (!cardEl) { setHtml('#att-list-container', renderAttendanceList()); return; }
  const emp = EmployeeDB.getById(empId);
  const teams = TeamDB.getAll();
  const teamMap = {}; teams.forEach(t => teamMap[t.id] = t);
  if (!emp) return;
  const status = record ? record.status : 'unchecked';
  const team = teamMap[emp.teamId];
  const avatar = empAvatar(emp, 48);
  const settings = SettingsDB.get();
  const workHours = record && record.checkIn && record.checkOut
    ? DateUtils.calcWorkHours(record.checkIn, record.checkOut, settings.lunchBreakMinutes) : 0;
  const can = Auth.can('check_attendance');

  // Update border class
  cardEl.className = `att-card status-border-${status}`;
  cardEl.querySelector('.att-card-top').innerHTML = `
    <img src="${avatar}" alt="${escHtml(emp.firstName)}" class="att-emp-avatar" />
    <div class="att-emp-info">
      <div class="att-emp-name">${escHtml(emp.firstName)} ${escHtml(emp.lastName)}${emp.nickname?` <span class="att-emp-nick">(${escHtml(emp.nickname)})</span>`:''}</div>
      <div class="att-emp-meta">${escHtml(emp.id)}${team?` • <span style="color:${team.color}">${escHtml(team.name)}</span>`:''}</div>
      <div class="att-emp-pos">${escHtml(emp.position||'-')}</div>
    </div>
    <div class="att-current-status">
      ${StatusUtils.getBadge(status)}
      ${record&&record.checkIn?`<div class="att-time-display"><i class="fa-solid fa-clock"></i> ${record.checkIn}${record.checkOut?' - '+record.checkOut:''}</div>`:''}
      ${workHours>0?`<div class="att-hours-display">${fmtHours(workHours)} ชม.</div>`:''}
    </div>
  `;
  if (can) {
    const btnsEl = cardEl.querySelector('.att-status-btns');
    if (btnsEl) {
      btnsEl.querySelectorAll('.att-btn-status').forEach(btn => {
        btn.classList.remove('active');
        if (btn.classList.contains(`btn-${status}`)) btn.classList.add('active');
      });
    }
  }
}

// Batch check all unchecked as "present"
function batchCheckAll() {
  if (!Auth.requirePermission('check_attendance')) return;
  const employees = EmployeeDB.getActive();
  const records = AttendanceDB.getByDate(attDate);
  const recordMap = {};
  records.forEach(r => recordMap[r.employeeId] = r);
  const unchecked = employees.filter(e => !recordMap[e.id] || recordMap[e.id].status === 'unchecked');

  if (unchecked.length === 0) { showToast('ทุกคนถูกเช็คชื่อแล้ว', 'info'); return; }

  showConfirm(
    'เช็คชื่อแบบกลุ่ม',
    `ตั้งสถานะ <b>"มาทำงาน"</b> ให้คนที่ยังไม่ได้เช็ค <b>${unchecked.length} คน</b>?<br><small>คนที่ถูกเช็คไปแล้วจะไม่เปลี่ยน</small>`,
    () => {
      const settings = SettingsDB.get();
      unchecked.forEach(emp => {
        const record = {
          id: `${emp.id}_${attDate}`,
          employeeId: emp.id, date: attDate, status: 'present',
          checkIn: settings.defaultCheckInTime, checkOut: '17:30',
          lateMinutes: 0, leaveType: '', location: '', note: '', otHours: 0,
          createdBy: Auth.getUserName(), updatedBy: Auth.getUserName(),
        };
        AttendanceDB.save(record);
      });
      AuditDB.add({ action: 'BATCH_CHECK_ALL', entityType: 'attendance', entityId: attDate, description: `เช็คชื่อกลุ่ม ${unchecked.length} คน เป็น "มาทำงาน"`, performedBy: Auth.getUserName() });
      showToast(`เช็คชื่อ ${unchecked.length} คน เป็น "มาทำงาน" เรียบร้อย`, 'success');
      setHtml('#page-content', renderAttendancePage());
    }
  );
}

// Detail modal (time, note, OT)
function renderAttDetailModal() {
  return `
  <div id="att-detail-modal" class="modal-backdrop hidden">
    <div class="modal-box">
      <div class="modal-header">
        <h3 id="att-detail-title">รายละเอียดการทำงาน</h3>
        <button class="modal-close" onclick="closeAttDetail()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <form id="att-detail-form" class="modal-body" onsubmit="saveAttDetail(event)">
        <input type="hidden" id="att-detail-empid" />
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label"><i class="fa-solid fa-arrow-right-to-bracket"></i> เวลาเข้างาน</label>
            <input type="time" id="att-checkin" class="form-input" />
          </div>
          <div class="form-group">
            <label class="form-label"><i class="fa-solid fa-arrow-right-from-bracket"></i> เวลาออกงาน</label>
            <input type="time" id="att-checkout" class="form-input" />
          </div>
          <div class="form-group">
            <label class="form-label"><i class="fa-solid fa-business-time"></i> OT (ชั่วโมง)</label>
            <input type="number" id="att-ot" class="form-input" step="0.5" min="0" max="12" placeholder="0" />
          </div>
          <div class="form-group">
            <label class="form-label"><i class="fa-solid fa-tag"></i> ประเภทการลา</label>
            <select id="att-leavetype" class="form-select">
              <option value="">-- ไม่ใช่การลา --</option>
              ${LeaveTypeUtils.options()}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label"><i class="fa-solid fa-location-dot"></i> สถานที่ (กรณีนอกสถานที่)</label>
            <input type="text" id="att-location" class="form-input" placeholder="ระบุสถานที่" />
          </div>
          <div class="form-group form-group-full">
            <label class="form-label"><i class="fa-solid fa-note-sticky"></i> หมายเหตุ</label>
            <textarea id="att-note" class="form-input" rows="2" placeholder="หมายเหตุเพิ่มเติม"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeAttDetail()">ยกเลิก</button>
          <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> บันทึก</button>
        </div>
      </form>
    </div>
  </div>

  <div id="leave-modal" class="modal-backdrop hidden">
    <div class="modal-box modal-sm">
      <div class="modal-header"><h3>บันทึกการลางาน</h3><button class="modal-close" onclick="closeLeaveModal()"><i class="fa-solid fa-xmark"></i></button></div>
      <form class="modal-body" onsubmit="saveLeave(event)">
        <input type="hidden" id="leave-empid" />
        <div class="form-group">
          <label class="form-label">ประเภทการลา</label>
          <select id="leave-type" class="form-select">${LeaveTypeUtils.options()}</select>
        </div>
        <div class="form-group">
          <label class="form-label">หมายเหตุ</label>
          <textarea id="leave-note" class="form-input" rows="2" placeholder="เหตุผลการลา"></textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeLeaveModal()">ยกเลิก</button>
          <button type="submit" class="btn btn-leave"><i class="fa-solid fa-calendar-minus"></i> บันทึกการลา</button>
        </div>
      </form>
    </div>
  </div>

  <div id="absent-modal" class="modal-backdrop hidden">
    <div class="modal-box modal-sm">
      <div class="modal-header"><h3>บันทึกการขาดงาน</h3><button class="modal-close" onclick="closeAbsentModal()"><i class="fa-solid fa-xmark"></i></button></div>
      <form class="modal-body" onsubmit="saveAbsent(event)">
        <input type="hidden" id="absent-empid" />
        <div class="form-group">
          <label class="form-label">เหตุผล / หมายเหตุ</label>
          <textarea id="absent-note" class="form-input" rows="2" placeholder="เช่น ไม่แจ้งล่วงหน้า"></textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeAbsentModal()">ยกเลิก</button>
          <button type="submit" class="btn btn-danger"><i class="fa-solid fa-circle-xmark"></i> บันทึกขาดงาน</button>
        </div>
      </form>
    </div>
  </div>

  <div id="field-modal" class="modal-backdrop hidden">
    <div class="modal-box modal-sm">
      <div class="modal-header"><h3>บันทึกนอกสถานที่</h3><button class="modal-close" onclick="closeFieldModal()"><i class="fa-solid fa-xmark"></i></button></div>
      <form class="modal-body" onsubmit="saveField(event)">
        <input type="hidden" id="field-empid" />
        <div class="form-group">
          <label class="form-label">สถานที่</label>
          <input type="text" id="field-location" class="form-input" placeholder="เช่น ไปตรวจงาน Warehouse C" required />
        </div>
        <div class="form-group">
          <label class="form-label">หมายเหตุ</label>
          <textarea id="field-note" class="form-input" rows="2"></textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeFieldModal()">ยกเลิก</button>
          <button type="submit" class="btn btn-field"><i class="fa-solid fa-location-dot"></i> บันทึก</button>
        </div>
      </form>
    </div>
  </div>
  `;
}

function openAttDetail(empId) {
  const emp = EmployeeDB.getById(empId);
  if (!emp) return;
  const record = AttendanceDB.getByEmployeeAndDate(empId, attDate);
  const modal = document.getElementById('att-detail-modal');
  if (!modal) return;
  document.getElementById('att-detail-title').textContent = `${emp.firstName} ${emp.lastName} — ${DateUtils.toDisplayDate(attDate)}`;
  setVal('#att-detail-empid', empId);
  setVal('#att-checkin', record ? record.checkIn||'' : '');
  setVal('#att-checkout', record ? record.checkOut||'' : '');
  setVal('#att-ot', record ? record.otHours||'' : '');
  setVal('#att-leavetype', record ? record.leaveType||'' : '');
  setVal('#att-location', record ? record.location||'' : '');
  setVal('#att-note', record ? record.note||'' : '');
  modal.classList.remove('hidden');
}

function closeAttDetail() { document.getElementById('att-detail-modal').classList.add('hidden'); }

function saveAttDetail(event) {
  event.preventDefault();
  const empId = val('#att-detail-empid');
  const checkIn = val('#att-checkin');
  const checkOut = val('#att-checkout');
  const timeErr = Validate.timeOrder(checkIn, checkOut);
  if (timeErr) { showToast(timeErr, 'error'); return; }
  const existing = AttendanceDB.getByEmployeeAndDate(empId, attDate);
  const record = {
    ...(existing || {}),
    id: `${empId}_${attDate}`, employeeId: empId, date: attDate,
    status: existing ? existing.status : 'present',
    checkIn, checkOut, otHours: parseFloat(val('#att-ot'))||0,
    leaveType: val('#att-leavetype'), location: val('#att-location'), note: val('#att-note'),
    createdBy: existing ? existing.createdBy : Auth.getUserName(), updatedBy: Auth.getUserName(),
  };
  const settings = SettingsDB.get();
  if (checkIn) record.lateMinutes = DateUtils.calcLateMinutes(checkIn, settings.defaultCheckInTime);
  AttendanceDB.save(record);
  AuditDB.add({ action: 'EDIT_ATTENDANCE_DETAIL', entityType: 'attendance', entityId: record.id, description: `แก้ไขรายละเอียด ${empId}`, performedBy: Auth.getUserName() });
  closeAttDetail();
  showToast('บันทึกรายละเอียดการทำงานเรียบร้อย', 'success');
  refreshAttCard(empId, record);
  const summaryEl = document.querySelector('.att-summary-bar');
  if (summaryEl) summaryEl.outerHTML = renderAttSummaryBar();
}

// Leave modal
function openLeaveModal(empId) {
  const modal = document.getElementById('leave-modal');
  if (!modal) return;
  setVal('#leave-empid', empId);
  setVal('#leave-type', 'sick'); setVal('#leave-note', '');
  modal.classList.remove('hidden');
}
function closeLeaveModal() { document.getElementById('leave-modal').classList.add('hidden'); }
function saveLeave(event) {
  event.preventDefault();
  const empId = val('#leave-empid');
  const emp = EmployeeDB.getById(empId);
  const existing = AttendanceDB.getByEmployeeAndDate(empId, attDate);
  const prevStatus = existing ? existing.status : 'unchecked';
  const record = { ...(existing||{}), id:`${empId}_${attDate}`, employeeId:empId, date:attDate, status:'leave', checkIn:'', checkOut:'', leaveType:val('#leave-type'), note:val('#leave-note'), otHours:0, createdBy:existing?existing.createdBy:Auth.getUserName(), updatedBy:Auth.getUserName() };
  AttendanceDB.save(record);
  AuditDB.add({ action:'SET_ATTENDANCE', entityType:'attendance', entityId:record.id, description:`${emp?emp.firstName:empId}: ${StatusUtils.getLabel(prevStatus)} → ลางาน (${LeaveTypeUtils.getLabel(record.leaveType)})`, before:{status:prevStatus}, after:{status:'leave'}, performedBy:Auth.getUserName() });
  closeLeaveModal();
  showToast(`${emp?emp.firstName:empId} — ลางาน (${LeaveTypeUtils.getLabel(record.leaveType)})`, 'success');
  refreshAttCard(empId, record);
  const sb = document.querySelector('.att-summary-bar'); if(sb) sb.outerHTML = renderAttSummaryBar();
}

// Absent modal
function openAbsentModal(empId) {
  const modal = document.getElementById('absent-modal');
  if (!modal) return;
  setVal('#absent-empid', empId); setVal('#absent-note', '');
  modal.classList.remove('hidden');
}
function closeAbsentModal() { document.getElementById('absent-modal').classList.add('hidden'); }
function saveAbsent(event) {
  event.preventDefault();
  const empId = val('#absent-empid');
  const emp = EmployeeDB.getById(empId);
  const existing = AttendanceDB.getByEmployeeAndDate(empId, attDate);
  const prevStatus = existing ? existing.status : 'unchecked';
  const record = { ...(existing||{}), id:`${empId}_${attDate}`, employeeId:empId, date:attDate, status:'absent', checkIn:'', checkOut:'', leaveType:'', note:val('#absent-note'), otHours:0, createdBy:existing?existing.createdBy:Auth.getUserName(), updatedBy:Auth.getUserName() };
  AttendanceDB.save(record);
  AuditDB.add({ action:'SET_ATTENDANCE', entityType:'attendance', entityId:record.id, description:`${emp?emp.firstName:empId}: ${StatusUtils.getLabel(prevStatus)} → ขาดงาน`, before:{status:prevStatus}, after:{status:'absent'}, performedBy:Auth.getUserName() });
  closeAbsentModal();
  showToast(`${emp?emp.firstName:empId} — ขาดงาน`, 'warning');
  refreshAttCard(empId, record);
  const sb = document.querySelector('.att-summary-bar'); if(sb) sb.outerHTML = renderAttSummaryBar();
}

// Field modal
function openFieldModal(empId) {
  const modal = document.getElementById('field-modal');
  if (!modal) return;
  const existing = AttendanceDB.getByEmployeeAndDate(empId, attDate);
  setVal('#field-empid', empId);
  setVal('#field-location', existing?existing.location||'':'');
  setVal('#field-note', existing?existing.note||'':'');
  modal.classList.remove('hidden');
}
function closeFieldModal() { document.getElementById('field-modal').classList.add('hidden'); }
function saveField(event) {
  event.preventDefault();
  const empId = val('#field-empid');
  const emp = EmployeeDB.getById(empId);
  const existing = AttendanceDB.getByEmployeeAndDate(empId, attDate);
  const prevStatus = existing ? existing.status : 'unchecked';
  const settings = SettingsDB.get();
  const record = { ...(existing||{}), id:`${empId}_${attDate}`, employeeId:empId, date:attDate, status:'field', checkIn:existing&&existing.checkIn||settings.defaultCheckInTime, checkOut:existing&&existing.checkOut||'17:30', leaveType:'', location:val('#field-location'), note:val('#field-note'), otHours:existing?existing.otHours||0:0, createdBy:existing?existing.createdBy:Auth.getUserName(), updatedBy:Auth.getUserName() };
  AttendanceDB.save(record);
  AuditDB.add({ action:'SET_ATTENDANCE', entityType:'attendance', entityId:record.id, description:`${emp?emp.firstName:empId}: ${StatusUtils.getLabel(prevStatus)} → นอกสถานที่ (${record.location})`, before:{status:prevStatus}, after:{status:'field'}, performedBy:Auth.getUserName() });
  closeFieldModal();
  showToast(`${emp?emp.firstName:empId} — นอกสถานที่: ${record.location}`, 'success');
  refreshAttCard(empId, record);
  const sb = document.querySelector('.att-summary-bar'); if(sb) sb.outerHTML = renderAttSummaryBar();
}
