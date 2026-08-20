/**
 * db.js - LocalStorage Database Layer
 * All data read/write operations go through this module.
 */

const DB_KEYS = {
  EMPLOYEES: "atd_employees",
  TEAMS: "atd_teams",
  ATTENDANCE: "atd_attendance",
  USERS: "atd_users",
  AUDIT_LOG: "atd_audit_log",
  SETTINGS: "atd_settings",
  SESSION: "atd_session",
};

function dbGet(key) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; }
  catch(e) { console.error("[DB] Read error:", key, e); return null; }
}
function dbSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch(e) { console.error("[DB] Write error:", key, e); return false; }
}

// ─── Employees ───────────────────────────────────────────────────────────────
const EmployeeDB = {
  getAll() { return dbGet(DB_KEYS.EMPLOYEES) || []; },
  getActive() { return this.getAll().filter(e => e.isActive); },
  getById(id) { return this.getAll().find(e => e.id === id) || null; },
  save(employee) {
    const list = this.getAll();
    const idx = list.findIndex(e => e.id === employee.id);
    employee.updatedAt = new Date().toISOString();
    if (idx === -1) { employee.createdAt = employee.updatedAt; list.push(employee); }
    else list[idx] = { ...list[idx], ...employee };
    dbSet(DB_KEYS.EMPLOYEES, list);
    return employee;
  },
  delete(id) { dbSet(DB_KEYS.EMPLOYEES, this.getAll().filter(e => e.id !== id)); },
  toggleActive(id) {
    const list = this.getAll(); const emp = list.find(e => e.id === id);
    if (emp) { emp.isActive = !emp.isActive; emp.updatedAt = new Date().toISOString(); dbSet(DB_KEYS.EMPLOYEES, list); return emp; }
    return null;
  },
  isIdTaken(id, excludeId = null) { return this.getAll().some(e => e.id === id && e.id !== excludeId); },
};

// ─── Teams ───────────────────────────────────────────────────────────────────
const TeamDB = {
  getAll() { return dbGet(DB_KEYS.TEAMS) || []; },
  getById(id) { return this.getAll().find(t => t.id === id) || null; },
  save(team) {
    const list = this.getAll(); const idx = list.findIndex(t => t.id === team.id);
    team.updatedAt = new Date().toISOString();
    if (idx === -1) { team.createdAt = team.updatedAt; list.push(team); }
    else list[idx] = { ...list[idx], ...team };
    dbSet(DB_KEYS.TEAMS, list); return team;
  },
  delete(id) { dbSet(DB_KEYS.TEAMS, this.getAll().filter(t => t.id !== id)); },
  getMemberCount(teamId) { return EmployeeDB.getAll().filter(e => e.teamId === teamId && e.isActive).length; },
};

// ─── Attendance ──────────────────────────────────────────────────────────────
const AttendanceDB = {
  _key(empId, date) { return `${empId}_${date}`; },
  getAll() { return dbGet(DB_KEYS.ATTENDANCE) || {}; },
  getByDate(date) { return Object.values(this.getAll()).filter(r => r.date === date); },
  getByEmployee(empId) {
    return Object.values(this.getAll()).filter(r => r.employeeId === empId).sort((a,b) => b.date.localeCompare(a.date));
  },
  getByEmployeeAndDate(empId, date) { return this.getAll()[this._key(empId, date)] || null; },
  save(record) {
    const all = this.getAll(); const key = this._key(record.employeeId, record.date);
    record.updatedAt = new Date().toISOString();
    if (!record.createdAt) { record.createdAt = record.updatedAt; record.id = key; }
    all[key] = record; dbSet(DB_KEYS.ATTENDANCE, all); return record;
  },
  delete(empId, date) { const all = this.getAll(); delete all[this._key(empId, date)]; dbSet(DB_KEYS.ATTENDANCE, all); },
  getByEmployee(empId) {
    return Object.values(this.getAll()).filter(r => r.employeeId === empId).sort((a,b) => b.date.localeCompare(a.date));
  },
  getMonthSummary(year, month) {
    const monthStr = `${year}-${String(month).padStart(2,"0")}`;
    const result = {};
    Object.values(this.getAll()).forEach(r => {
      if (r.date && r.date.startsWith(monthStr)) {
        if (!result[r.date]) result[r.date] = {present:0,late:0,absent:0,leave:0,field:0,unchecked:0};
        const s = r.status || "unchecked";
        if (result[r.date][s] !== undefined) result[r.date][s]++;
      }
    });
    return result;
  },
};

// ─── Users ───────────────────────────────────────────────────────────────────
const UserDB = {
  getAll() { return dbGet(DB_KEYS.USERS) || []; },
  getByUsername(username) { return this.getAll().find(u => u.username === username) || null; },
  save(user) {
    const list = this.getAll(); const idx = list.findIndex(u => u.id === user.id);
    user.updatedAt = new Date().toISOString();
    if (idx === -1) { user.createdAt = user.updatedAt; list.push(user); }
    else list[idx] = { ...list[idx], ...user };
    dbSet(DB_KEYS.USERS, list); return user;
  },
};

// ─── Audit Log ───────────────────────────────────────────────────────────────
const AuditDB = {
  getAll() { return dbGet(DB_KEYS.AUDIT_LOG) || []; },
  add(entry) {
    const logs = this.getAll();
    entry.id = `audit_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
    entry.timestamp = new Date().toISOString();
    logs.unshift(entry);
    if (logs.length > 2000) logs.splice(2000);
    dbSet(DB_KEYS.AUDIT_LOG, logs); return entry;
  },
  getRecent(limit = 100) { return this.getAll().slice(0, limit); },
  clear() { dbSet(DB_KEYS.AUDIT_LOG, []); },
};

// ─── Settings ────────────────────────────────────────────────────────────────
const SettingsDB = {
  get() {
    return dbGet(DB_KEYS.SETTINGS) || {
      projectName: "ระบบเช็คชื่อพนักงาน", companyName: "บริษัท/โครงการ",
      defaultCheckInTime: "07:30", lateThresholdMinutes: 1,
      workHoursPerDay: 8, lunchBreakMinutes: 60,
    };
  },
  save(s) { dbSet(DB_KEYS.SETTINGS, s); },
};

// ─── Session ─────────────────────────────────────────────────────────────────
const SessionDB = {
  get() { return dbGet(DB_KEYS.SESSION) || {}; },
  save(s) { dbSet(DB_KEYS.SESSION, s); },
  clear() { dbSet(DB_KEYS.SESSION, {}); },
};

// ─── Backup ──────────────────────────────────────────────────────────────────
const BackupDB = {
  exportAll() {
    const data = {};
    Object.keys(DB_KEYS).forEach(k => { data[DB_KEYS[k]] = dbGet(DB_KEYS[k]); });
    return { version: "2.0", exportedAt: new Date().toISOString(), data };
  },
  importAll(backup) {
    if (!backup || !backup.data) throw new Error("ไฟล์ Backup ไม่ถูกต้อง");
    Object.keys(backup.data).forEach(key => { if (backup.data[key] !== null) dbSet(key, backup.data[key]); });
  },
};

// ─── Seed Demo Data ──────────────────────────────────────────────────────────
function seedDemoData() {
  if (EmployeeDB.getAll().length > 0) return;

  dbSet(DB_KEYS.USERS, [
    { id:"user-admin", username:"admin", password:"admin1234", role:"admin", name:"ผู้ดูแลระบบ", isActive:true },
    { id:"user-sup", username:"supervisor", password:"super1234", role:"supervisor", name:"หัวหน้างาน", isActive:true },
    { id:"user-view", username:"viewer", password:"view1234", role:"viewer", name:"ผู้ดูข้อมูล", isActive:true },
  ]);

  const teams = [
    { id:"team-a", name:"ทีม A", description:"ทีมช่างก่อสร้าง", color:"#3b82f6" },
    { id:"team-b", name:"ทีม B", description:"ทีมคนงานทั่วไป", color:"#10b981" },
  ];
  teams.forEach(t => { t.createdAt = new Date().toISOString(); t.updatedAt = t.createdAt; });
  dbSet(DB_KEYS.TEAMS, teams);

  const employees = [
    { id:"EMP-001", firstName:"สมชาย", lastName:"ใจดี", nickname:"ชาย", phone:"0811111111", position:"ช่าง", department:"ก่อสร้าง", teamId:"team-a", laborType:"technician", startDate:"2025-01-01", avatar:"", note:"", isActive:true },
    { id:"EMP-002", firstName:"สมศักดิ์", lastName:"รักงาน", nickname:"ศักดิ์", phone:"0822222222", position:"คนงาน", department:"ก่อสร้าง", teamId:"team-a", laborType:"worker", startDate:"2025-01-15", avatar:"", note:"", isActive:true },
    { id:"EMP-003", firstName:"วิชัย", lastName:"ก่อสร้าง", nickname:"ชัย", phone:"0833333333", position:"ช่างเชื่อม", department:"ก่อสร้าง", teamId:"team-a", laborType:"technician", startDate:"2025-02-01", avatar:"", note:"", isActive:true },
    { id:"EMP-004", firstName:"ประสิทธิ์", lastName:"ทำงาน", nickname:"สิทธิ์", phone:"0844444444", position:"ผู้รับเหมา", department:"ก่อสร้าง", teamId:"team-a", laborType:"contractor", startDate:"2025-03-01", avatar:"", note:"", isActive:true },
    { id:"EMP-005", firstName:"อนันต์", lastName:"ขยันดี", nickname:"นันต์", phone:"0855555555", position:"คนงาน", department:"ก่อสร้าง", teamId:"team-a", laborType:"worker", startDate:"2025-03-15", avatar:"", note:"", isActive:true },
    { id:"EMP-006", firstName:"กิตติ", lastName:"งานดี", nickname:"กิตติ", phone:"0866666666", position:"ช่าง", department:"ซ่อมบำรุง", teamId:"team-b", laborType:"technician", startDate:"2025-04-01", avatar:"", note:"", isActive:true },
    { id:"EMP-007", firstName:"เอกชัย", lastName:"หน้างาน", nickname:"เอก", phone:"0877777777", position:"คนงาน", department:"ซ่อมบำรุง", teamId:"team-b", laborType:"daily", startDate:"2025-04-15", avatar:"", note:"", isActive:true },
    { id:"EMP-008", firstName:"ธนกร", lastName:"วิศวกรรม", nickname:"กร", phone:"0888888888", position:"ช่าง", department:"ซ่อมบำรุง", teamId:"team-b", laborType:"technician", startDate:"2025-05-01", avatar:"", note:"", isActive:true },
  ];
  employees.forEach(e => { e.createdAt = new Date().toISOString(); e.updatedAt = e.createdAt; });
  dbSet(DB_KEYS.EMPLOYEES, employees);

  // Seed today attendance
  const today = new Date().toISOString().split("T")[0];
  const statuses = ["present","present","present","late","present","leave","present","present"];
  const checkIns = ["07:30","07:28","07:35","08:15","07:30","","07:32","07:29"];
  const checkOuts = ["17:30","17:30","17:35","17:30","17:30","","17:30","17:30"];
  const notes = ["","","","รถติด","","ลาป่วย","",""];
  const leaveTypes = ["","","","","","sick","",""];
  employees.forEach((emp, i) => {
    AttendanceDB.save({
      id: `${emp.id}_${today}`, employeeId:emp.id, date:today,
      status:statuses[i], checkIn:checkIns[i], checkOut:checkOuts[i],
      lateMinutes:statuses[i]==="late"?45:0, leaveType:leaveTypes[i],
      location:"", note:notes[i], otHours:i===0?1.5:0,
      createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
      createdBy:"admin", updatedBy:"admin",
    });
  });

  // Seed yesterday
  const yd = new Date(); yd.setDate(yd.getDate()-1);
  const ydStr = yd.toISOString().split("T")[0];
  const ydSt = ["present","present","absent","present","late","present","leave","present"];
  employees.forEach((emp, i) => {
    AttendanceDB.save({
      id:`${emp.id}_${ydStr}`, employeeId:emp.id, date:ydStr,
      status:ydSt[i], checkIn:ydSt[i]==="present"?"07:30":(ydSt[i]==="late"?"08:10":""),
      checkOut:(ydSt[i]==="present"||ydSt[i]==="late")?"17:30":"",
      lateMinutes:ydSt[i]==="late"?40:0, leaveType:ydSt[i]==="leave"?"personal":"",
      location:"", note:ydSt[i]==="absent"?"ไม่แจ้งล่วงหน้า":"",
      otHours:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
      createdBy:"admin", updatedBy:"admin",
    });
  });

  SettingsDB.save({
    projectName:"ระบบเช็คชื่อพนักงาน", companyName:"บริษัท ก่อสร้างไทย จำกัด",
    defaultCheckInTime:"07:30", lateThresholdMinutes:1, workHoursPerDay:8, lunchBreakMinutes:60,
  });
}
