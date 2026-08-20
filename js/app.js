/**
 * Main Application Logic - Attendance System v2.2 (Multi-Project & Mobile First)
 * Features:
 * - Multi-Project & Multi-Team Hierarchy with Real-time Counts
 * - Dual Attendance View: แผงการ์ด (Grid Panel) vs ลำดับรายชื่อ (Sequential List)
 * - Fixed Status Button Styling (Light/Outline when unselected, Solid when active)
 * - 100% Vector Thai PDF Print-to-PDF Engine (Sarabun font for A4)
 * - Excel & CSV Export pre-formatted for A4 printing
 * - Direct Worker Camera Photo Upload & Preset Avatars
 * - Mobile Touch Optimized for Site Operations
 */

// ─── TEMP DEBUG BANNER (แสดงสถานะ Firebase บนหน้าจอโดยตรง เพื่อช่วยตรวจสอบปัญหาซิงค์) ───
let debugBannerTimer = null;
function showDebugBanner(message, isError) {
  let el = document.getElementById('debug-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'debug-banner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;padding:10px 14px;font-family:monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;box-shadow:0 2px 6px rgba(0,0,0,0.3);transition:opacity 0.4s ease;';
    document.body.appendChild(el);
  }
  el.style.opacity = '1';
  el.style.background = isError ? '#fee2e2' : '#dcfce7';
  el.style.color = isError ? '#991b1b' : '#166534';
  el.style.border = isError ? '2px solid #ef4444' : '2px solid #22c55e';
  el.innerHTML = message + ' <span style="float:right;cursor:pointer;font-weight:bold;" onclick="document.getElementById(\'debug-banner\').remove()">[ปิด]</span>';

  // ให้แบนเนอร์หายไปเองอัตโนมัติ ไม่บังหน้าจอค้างไว้ (ข้อความ error ให้ค้างนานกว่าเล็กน้อย)
  if (debugBannerTimer) clearTimeout(debugBannerTimer);
  debugBannerTimer = setTimeout(() => {
    const banner = document.getElementById('debug-banner');
    if (banner) {
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 400);
    }
  }, isError ? 6000 : 3000);
}

window.addEventListener('error', function(e) {
  showDebugBanner('❌ JS Error: ' + e.message + ' (บรรทัด ' + e.lineno + ')', true);
});
window.addEventListener('unhandledrejection', function(e) {
  showDebugBanner('❌ Promise Error: ' + (e.reason && e.reason.message ? e.reason.message : e.reason), true);
});
// ─── END TEMP DEBUG BANNER ───

const DB_KEYS = {
  PROJECTS: 'atd_projects_v2',
  TEAMS: 'atd_teams_v2',
  EMPLOYEES: 'atd_employees_v2',
  ATTENDANCE: 'atd_attendance_v2',
  SETTINGS: 'atd_settings_v2',
  AUDIT: 'atd_audit_v2',
  SESSION: 'atd_session_v2'
};

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBg3RdyVoFABoYJobnShhd05AHrtkxtfwY",
  authDomain: "construction-attendance-163df.firebaseapp.com",
  projectId: "construction-attendance-163df",
  storageBucket: "construction-attendance-163df.firebasestorage.app",
  messagingSenderId: "71500543827",
  appId: "1:71500543827:web:cbd935dc664bfc1732d3a6",
  measurementId: "G-RW3TC3C36J"
};

let firebaseDb = null;
let isRemoteUpdating = false;
// เก็บเวลาที่เขียนข้อมูลแต่ละ key ล่าสุดจากเครื่องนี้ ใช้กันไม่ให้ snapshot จาก Firebase
// ที่มาช้า (ข้อมูลเก่ากว่าที่เพิ่งบันทึกไปในเครื่อง) มาเขียนทับข้อมูลใหม่จนหายไป
const pendingLocalWrites = {};

function getStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('Storage Read Error', e);
    return null;
  }
}

function setStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    
    // Sync to Firebase Cloud if configured and not currently processing remote update
    if (firebaseDb && !isRemoteUpdating) {
      const writeTime = Date.now();
      pendingLocalWrites[key] = writeTime;
      firebaseDb.collection('attendance_data').doc(key).set({
        data: value,
        updatedAt: writeTime
      }).then(() => {
        // ล้างสถานะ pending เฉพาะเมื่อยังไม่มีการเขียนทับใหม่กว่านี้ระหว่างรอ
        if (pendingLocalWrites[key] === writeTime) {
          delete pendingLocalWrites[key];
        }
      }).catch(err => {
        console.warn('Firebase Cloud sync background notice:', err);
      });
    }
    return true;
  } catch (e) {
    console.error('Storage Write Error', e);
    return false;
  }
}

// ─── Firebase Cloud Sync Setup & Real-time Listeners ──────────────────────────

function initFirebaseSync() {
  if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.projectId) {
    showDebugBanner('⚠️ ไม่พบ FIREBASE_CONFIG หรือค่าไม่ครบ — ระบบจะใช้ localStorage อย่างเดียว (ไม่ซิงค์)', true);
    return;
  }

  try {
    if (typeof firebase === 'undefined') {
      showDebugBanner('❌ โหลด Firebase SDK ไม่สำเร็จ (ตัวแปร firebase ไม่ถูกกำหนด) — เช็คว่าอินเทอร์เน็ต/สคริปต์ Firebase โหลดได้หรือไม่', true);
      return;
    }

    let app;
    if (!firebase.apps.length) {
      app = firebase.initializeApp(FIREBASE_CONFIG);
    } else {
      app = firebase.app();
    }
    firebaseDb = firebase.firestore();

    // บังคับใช้ Long-Polling แทน WebSocket เพื่อให้ทำงานได้แม้อยู่หลัง Firewall/เครือข่ายมือถือที่บล็อก WebSocket
    try {
      firebaseDb.settings({ experimentalForceLongPolling: true, merge: true });
    } catch (settingsErr) {
      // ถ้าตั้งค่าไม่ได้ (เช่นเรียกซ้ำ) ให้ข้ามไป ไม่กระทบการทำงานหลัก
    }

    showDebugBanner('🔄 กำลังเชื่อมต่อ Firebase... (project: ' + FIREBASE_CONFIG.projectId + ')', false);

    // Listen to real-time changes across all devices
    firebaseDb.collection('attendance_data').onSnapshot(snapshot => {
      let hasChanges = false;
      snapshot.docChanges().forEach(change => {
        const docKey = change.doc.id;
        const docData = change.doc.data();
        if (docData && docData.data !== undefined) {
          // ถ้าเรามีการบันทึกจากเครื่องนี้ล่าสุด (ยังรอ/เพิ่งจบ) ที่ใหม่กว่าข้อมูลที่ได้จาก
          // snapshot นี้ แสดงว่า snapshot มาช้า/เป็นข้อมูลเก่า ให้ข้ามไปเพื่อไม่ให้ข้อมูลที่เพิ่งเพิ่ม
          // (เช่น คนงานที่เพิ่งเพิ่ม) ถูกเขียนทับจนหายไป
          const pendingAt = pendingLocalWrites[docKey];
          if (pendingAt && (docData.updatedAt === undefined || docData.updatedAt < pendingAt)) {
            return;
          }
          isRemoteUpdating = true;
          localStorage.setItem(docKey, JSON.stringify(docData.data));
          isRemoteUpdating = false;
          hasChanges = true;
        }
      });

      showDebugBanner('✅ Firebase เชื่อมต่อสำเร็จ | เอกสารที่ได้รับ: ' + snapshot.size + ' | มีการอัปเดตรอบนี้: ' + hasChanges + ' | เวลา: ' + new Date().toLocaleTimeString('th-TH'), false);

      if (hasChanges) {
        renderNavBars();
        renderCurrentPage();
      }
    }, err => {
      showDebugBanner('❌ Firebase Listener Error: ' + err.code + ' - ' + err.message, true);
    });

  } catch (err) {
    showDebugBanner('❌ Firebase Init Error: ' + err.message, true);
  }
}

const STATUS_CONFIG = {
  present: { label: 'มาทำงาน', icon: 'fa-circle-check', color: '#10b981', bg: '#ecfdf5', abbr: 'P' },
  late: { label: 'มาสาย', icon: 'fa-clock', color: '#f59e0b', bg: '#fffbeb', abbr: 'LT' },
  leave: { label: 'ลางาน', icon: 'fa-calendar-minus', color: '#8b5cf6', bg: '#f5f3ff', abbr: 'L' },
  absent: { label: 'ขาดงาน', icon: 'fa-circle-xmark', color: '#ef4444', bg: '#fef2f2', abbr: 'A' },
  field: { label: 'นอกสถานที่', icon: 'fa-location-dot', color: '#0284c7', bg: '#f0f9ff', abbr: 'F' },
  unchecked: { label: 'ยังไม่เช็ค', icon: 'fa-circle-dot', color: '#94a3b8', bg: '#f8fafc', abbr: '-' }
};

const LABOR_TYPES = {
  technician: 'ช่างฝีมือ',
  worker: 'คนงานทั่วไป',
  daily: 'พนักงานรายวัน',
  contractor: 'ผู้รับเหมาช่วง',
  employee: 'พนักงานประจำ',
  other: 'อื่น ๆ'
};

const LEAVE_TYPES = {
  sick: 'ลาป่วย',
  personal: 'ลากิจ',
  vacation: 'ลาพักร้อน',
  other: 'ลาอื่น ๆ'
};

// Preset Avatars for quick selection
const AVATAR_PRESETS = [
  { name: 'ช่างโครงสร้าง', url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80' },
  { name: 'วิศวกรสนาม', url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80' },
  { name: 'ช่างเชื่อม', url: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80' },
  { name: 'โฟร์แมนหญิง', url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80' },
  { name: 'คนงานหญิง', url: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80' },
  { name: 'ช่างไฟฟ้า', url: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80' }
];

const state = {
  currentView: 'attendance',
  currentDate: new Date().toISOString().split('T')[0],
  activeProjectId: 'all', // 'all' or project ID
  viewMode: 'list', // 'list' (ลำดับรายชื่อ) or 'grid' (แผงการ์ด)
  searchQuery: '',
  filterTeam: 'all',
  filterStatus: 'all',
  selectedEmployeeId: null,
  lastAction: null,
  photoModalTempAvatar: ''
};

function formatThaiDate(isoDate) {
  if (!isoDate) return '-';
  const [y, m, d] = isoDate.split('-');
  const thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${parseInt(d)} ${thMonths[parseInt(m) - 1]} ${parseInt(y) + 543}`;
}

function formatThaiFullDate(isoDate) {
  if (!isoDate) return '-';
  const [y, m, d] = isoDate.split('-');
  const thMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const dayNames = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
  const dt = new Date(isoDate + 'T00:00:00');
  return `${dayNames[dt.getDay()]}ที่ ${parseInt(d)} ${thMonths[parseInt(m) - 1]} พ.ศ. ${parseInt(y) + 543}`;
}

function getInitialsAvatar(name, size = 64) {
  const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#0284c7', '#ec4899', '#f97316'];
  const char = name ? name.trim().charAt(0) : 'W';
  const colorIndex = (char.charCodeAt(0) || 0) % colors.length;
  const bg = colors[colorIndex];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${size/2}" fill="${bg}"/>
    <text x="50%" y="53%" dominant-baseline="central" text-anchor="middle" fill="#ffffff" font-size="${Math.floor(size*0.42)}" font-family="Prompt, sans-serif" font-weight="bold">${char}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getEmployeeAvatar(emp, size = 52) {
  if (emp && emp.avatar && (emp.avatar.startsWith('data:image') || emp.avatar.startsWith('http'))) {
    return emp.avatar;
  }
  return getInitialsAvatar((emp ? emp.firstName : ''), size);
}

function showToast(message, type = 'success', undoCallback = null) {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;

  const id = `toast-${Date.now()}`;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.id = id;

  let icon = '<i class="fa-solid fa-circle-check" style="color:var(--color-present);"></i>';
  if (type === 'error') icon = '<i class="fa-solid fa-circle-xmark" style="color:var(--color-absent);"></i>';
  if (type === 'warning') icon = '<i class="fa-solid fa-triangle-exclamation" style="color:var(--color-late);"></i>';

  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.5rem;">
      ${icon}
      <span>${message}</span>
    </div>
    ${undoCallback ? `<button class="toast-undo-btn" onclick="executeUndo('${id}')"><i class="fa-solid fa-rotate-left"></i> ย้อนกลับ</button>` : ''}
  `;

  if (undoCallback) {
    state.lastUndoFn = undoCallback;
  }

  wrap.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, undoCallback ? 5000 : 3200);
}

function executeUndo(toastId) {
  if (state.lastUndoFn) {
    state.lastUndoFn();
    state.lastUndoFn = null;
    showToast('ย้อนกลับรายการเรียบร้อยแล้ว', 'warning');
    const toast = document.getElementById(toastId);
    if (toast) toast.remove();
  }
}

function openModal(html) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = html;
}

function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

// ─── Demo Data Seeding (Multi-Project & Multi-Team) ───────────────────────────

function seedInitialData() {
  const existingProjects = getStorage(DB_KEYS.PROJECTS);
  if (existingProjects && existingProjects.length > 0) return;

  // 1. Projects
  const projects = [
    { id: 'proj-1', name: 'โครงการก่อสร้างอาคารชุด ไซต์งาน A', companyName: 'บริษัท คอนสตรัคชั่น แมนเนจเมนท์ จำกัด', supervisorName: 'นายสมเกียรติ มั่นคง (Site Manager)', color: '#2563eb' },
    { id: 'proj-2', name: 'โครงการอาคารพาณิชย์ & โกดัง B', companyName: 'บริษัท สยามบิลเดอร์ จำกัด', supervisorName: 'นายธนกร วิศวกรรม (Site Eng)', color: '#10b981' }
  ];
  setStorage(DB_KEYS.PROJECTS, projects);

  // 2. Teams with Project links
  const teams = [
    { id: 'team-a', projectId: 'proj-1', name: 'ทีม A (งานโครงสร้าง)', description: 'งานเทปูน ผูกเหล็ก ก่อสร้างหลัก', color: '#2563eb' },
    { id: 'team-b', projectId: 'proj-1', name: 'ทีม B (งานระบบ & ช่าง)', description: 'งานไฟฟ้า ประปา เชื่อมเหล็ก', color: '#10b981' },
    { id: 'team-c', projectId: 'proj-2', name: 'ทีม C (งานโกดัง & เมทัลชีท)', description: 'งานติดตั้งโครงหลังคาและผนัง', color: '#8b5cf6' }
  ];
  setStorage(DB_KEYS.TEAMS, teams);

  // 3. Employees with Project and Team links
  const employees = [
    { id: 'EMP-001', projectId: 'proj-1', teamId: 'team-a', firstName: 'สมชาย', lastName: 'ใจดี', nickname: 'ชาย', phone: '081-234-5678', position: 'หัวหน้าช่างโครงสร้าง', department: 'ฝ่ายก่อสร้าง', laborType: 'technician', startDate: '2025-01-10', avatar: AVATAR_PRESETS[0].url, note: 'ผ่านการอบรม จป.หัวหน้างาน', isActive: true },
    { id: 'EMP-002', projectId: 'proj-1', teamId: 'team-a', firstName: 'สมศักดิ์', lastName: 'รักงาน', nickname: 'ศักดิ์', phone: '082-345-6789', position: 'คนงานทั่วไป', department: 'ฝ่ายก่อสร้าง', laborType: 'worker', startDate: '2025-02-01', avatar: AVATAR_PRESETS[1].url, note: '', isActive: true },
    { id: 'EMP-003', projectId: 'proj-1', teamId: 'team-a', firstName: 'วิชัย', lastName: 'ก่อสร้าง', nickname: 'ชัย', phone: '083-456-7890', position: 'ช่างเชื่อมโลหะ', department: 'ฝ่ายก่อสร้าง', laborType: 'technician', startDate: '2025-02-15', avatar: AVATAR_PRESETS[2].url, note: 'มีใบเซอร์ช่างเชื่อม', isActive: true },
    { id: 'EMP-004', projectId: 'proj-1', teamId: 'team-a', firstName: 'ประสิทธิ์', lastName: 'ทำงาน', nickname: 'สิทธิ์', phone: '084-567-8901', position: 'ผู้รับเหมาช่วง', department: 'ฝ่ายก่อสร้าง', laborType: 'contractor', startDate: '2025-03-01', avatar: '', note: 'ทีมรับเหมางานเหล็ก', isActive: true },
    { id: 'EMP-005', projectId: 'proj-1', teamId: 'team-b', firstName: 'อนันต์', lastName: 'ขยันดี', nickname: 'นันต์', phone: '085-678-9012', position: 'คนงานรายวัน', department: 'ฝ่ายก่อสร้าง', laborType: 'daily', startDate: '2025-03-10', avatar: '', note: '', isActive: true },
    { id: 'EMP-006', projectId: 'proj-1', teamId: 'team-b', firstName: 'กิตติ', lastName: 'งานดี', nickname: 'กิต', phone: '086-789-0123', position: 'ช่างไฟฟ้ากำลัง', department: 'ฝ่ายระบบ', laborType: 'technician', startDate: '2025-04-01', avatar: AVATAR_PRESETS[5].url, note: 'ดูแลตู้ MDB ไซต์งาน', isActive: true },
    { id: 'EMP-007', projectId: 'proj-2', teamId: 'team-c', firstName: 'เอกชัย', lastName: 'หน้างาน', nickname: 'เอก', phone: '087-890-1234', position: 'ช่างสุขาภิบาล & ประปา', department: 'ฝ่ายระบบ', laborType: 'technician', startDate: '2025-04-15', avatar: '', note: '', isActive: true },
    { id: 'EMP-008', projectId: 'proj-2', teamId: 'team-c', firstName: 'ธนกร', lastName: 'วิศวกรรม', nickname: 'กร', phone: '088-901-2345', position: 'วิศวกรสนาม (Site Eng)', department: 'ฝ่ายวิศวกรรม', laborType: 'employee', startDate: '2025-05-01', avatar: AVATAR_PRESETS[1].url, note: 'ประสานงานผู้ควบคุมงาน', isActive: true }
  ];
  setStorage(DB_KEYS.EMPLOYEES, employees);

  // 4. Sample Attendance
  const today = new Date().toISOString().split('T')[0];
  const attendance = {};
  
  attendance[`EMP-001_${today}`] = { employeeId: 'EMP-001', date: today, status: 'present', checkIn: '07:25', checkOut: '17:30', otHours: '1.5', note: 'ควบคุมงานเทคอนกรีตฐานราก' };
  attendance[`EMP-002_${today}`] = { employeeId: 'EMP-002', date: today, status: 'present', checkIn: '07:30', checkOut: '17:30', otHours: '0', note: '' };
  attendance[`EMP-003_${today}`] = { employeeId: 'EMP-003', date: today, status: 'late', checkIn: '08:15', checkOut: '17:30', otHours: '0', note: 'รถติดสะพานพระราม 9' };
  attendance[`EMP-004_${today}`] = { employeeId: 'EMP-004', date: today, status: 'present', checkIn: '07:30', checkOut: '17:30', otHours: '2.0', note: '' };
  attendance[`EMP-005_${today}`] = { employeeId: 'EMP-005', date: today, status: 'leave', checkIn: '', checkOut: '', leaveType: 'sick', note: 'มีใบรับรองแพทย์' };
  attendance[`EMP-006_${today}`] = { employeeId: 'EMP-006', date: today, status: 'field', checkIn: '07:30', checkOut: '17:00', location: 'ตรวจหม้อแปลงไฟฟ้าสาขาบางนา', note: '' };
  attendance[`EMP-007_${today}`] = { employeeId: 'EMP-007', date: today, status: 'present', checkIn: '07:28', checkOut: '17:30', otHours: '0', note: '' };
  attendance[`EMP-008_${today}`] = { employeeId: 'EMP-008', date: today, status: 'present', checkIn: '07:30', checkOut: '18:00', otHours: '1.0', note: 'ประชุมส่งมอบงวดงาน' };

  setStorage(DB_KEYS.ATTENDANCE, attendance);

  setStorage(DB_KEYS.SETTINGS, {
    standardCheckIn: '07:30',
    standardCheckOut: '17:30',
    lunchBreakHours: '1.0'
  });
}

// ─── Topbar & Sidebar Navigation ──────────────────────────────────────────────

function renderNavBars() {
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const currentProject = projects.find(p => p.id === state.activeProjectId) || null;

  // Topbar
  const topbar = document.getElementById('topbar');
  if (topbar) {
    topbar.innerHTML = `
      <div class="topbar-left">
        <button class="mobile-menu-btn" onclick="openMobileDrawer()" aria-label="เปิดเมนู">
          <i class="fa-solid fa-bars"></i>
        </button>
        <select class="topbar-project-select" onchange="changeActiveProject(this.value)" title="เลือกโครงการ">
          <option value="all" ${state.activeProjectId === 'all' ? 'selected' : ''}>🏢 ทุกโครงการ (${projects.length})</option>
          ${projects.map(p => `<option value="${p.id}" ${state.activeProjectId === p.id ? 'selected' : ''}>📍 ${p.name}</option>`).join('')}
        </select>
      </div>
      <div class="topbar-right">
        <div class="topbar-clock" id="live-clock">
          <i class="fa-regular fa-clock"></i> <span id="clock-text">--:--:--</span>
        </div>
        <button id="manual-save-btn" class="btn btn-outline btn-sm" onclick="saveNow()" title="บันทึกข้อมูลขึ้นคลาวด์">
          <i class="fa-solid fa-cloud-arrow-up"></i> <span class="btn-text-desktop">บันทึกข้อมูล</span>
        </button>
        <button id="manual-refresh-btn" class="btn btn-outline btn-sm" onclick="refreshNow()" title="รีเฟรชข้อมูลล่าสุด">
          <i class="fa-solid fa-rotate"></i> <span class="btn-text-desktop">รีเฟรชข้อมูล</span>
        </button>
        <button class="btn btn-outline btn-sm" onclick="openAddProjectModal()" title="เพิ่มโครงการใหม่">
          <i class="fa-solid fa-folder-plus"></i> <span class="btn-text-desktop">เพิ่มโครงการ</span>
        </button>
        <button class="btn btn-outline btn-sm" onclick="navigateTo('backup')" title="สำรองและกู้คืน">
          <i class="fa-solid fa-database"></i> <span class="btn-text-desktop">สำรอง</span>
        </button>
      </div>
    `;
  }

  // Sidebar Menu HTML
  const navItems = [
    { id: 'attendance', label: 'เช็คชื่อการทำงาน', icon: 'fa-clipboard-user' },
    { id: 'projects_teams', label: 'โครงการ & ทีมงาน', icon: 'fa-sitemap' },
    { id: 'dashboard', label: 'แดชบอร์ดสรุปผล', icon: 'fa-chart-pie' },
    { id: 'employees', label: 'จัดการรายชื่อคนงาน', icon: 'fa-users' },
    { id: 'reports', label: 'รายงาน & ส่งออก', icon: 'fa-file-lines' },
    { id: 'backup', label: 'สำรอง & กู้คืนข้อมูล', icon: 'fa-database' }
  ];

  const menuHtml = `
    <div class="sidebar-brand">
      <div class="sidebar-logo-icon"><i class="fa-solid fa-helmet-safety"></i></div>
      <div class="sidebar-brand-text">
        <h2>ระบบเช็คชื่อไซต์งาน</h2>
        <span>Construction Attendance</span>
      </div>
    </div>
    <ul class="sidebar-menu">
      ${navItems.map(item => `
        <li class="sidebar-item ${state.currentView === item.id ? 'active' : ''}">
          <a href="javascript:void(0)" onclick="navigateTo('${item.id}')">
            <i class="fa-solid ${item.icon}"></i>
            <span>${item.label}</span>
          </a>
        </li>
      `).join('')}
    </ul>
    <div class="sidebar-user">
      <div class="sidebar-user-info">
        <div class="sidebar-user-avatar">วิ</div>
        <div>
          <div class="sidebar-user-name">${currentProject ? currentProject.supervisorName : 'วิศวกรผู้ควบคุม'}</div>
          <div class="sidebar-user-role">Site Supervisor</div>
        </div>
      </div>
    </div>
  `;

  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.innerHTML = menuHtml;

  const drawer = document.getElementById('drawer');
  if (drawer) drawer.innerHTML = menuHtml;

  // Bottom Tabs (Mobile)
  const bottomTabs = document.getElementById('bottomTabs');
  if (bottomTabs) {
    const mobileTabs = [
      { id: 'attendance', label: 'เช็คชื่อ', icon: 'fa-clipboard-user' },
      { id: 'projects_teams', label: 'โครงการ/ทีม', icon: 'fa-sitemap' },
      { id: 'dashboard', label: 'แดชบอร์ด', icon: 'fa-chart-pie' },
      { id: 'employees', label: 'คนงาน', icon: 'fa-users' },
      { id: 'reports', label: 'รายงาน', icon: 'fa-file-lines' }
    ];
    bottomTabs.innerHTML = mobileTabs.map(tab => `
      <button class="tab-btn ${state.currentView === tab.id ? 'active' : ''}" onclick="navigateTo('${tab.id}')">
        <i class="fa-solid ${tab.icon}"></i>
        <span>${tab.label}</span>
      </button>
    `).join('');
  }
}

function changeActiveProject(projectId) {
  state.activeProjectId = projectId;
  state.filterTeam = 'all'; // reset team filter on project change
  renderNavBars();
  renderCurrentPage();
  
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const p = projects.find(x => x.id === projectId);
  showToast(`เลือกดูข้อมูล: ${p ? p.name : 'ทุกโครงการ'}`, 'info');
}

// ─── Project Modals ───────────────────────────────────────────────────────────

function openAddProjectModal() {
  const modalHtml = `
    <div class="modal-backdrop">
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3><i class="fa-solid fa-folder-plus" style="color:var(--primary);"></i> เพิ่มโครงการใหม่</h3>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <form class="modal-body" onsubmit="saveProjectForm(event)">
          <div class="form-group">
            <label class="form-label"><i class="fa-solid fa-building"></i> ชื่อโครงการ / ไซต์งาน *</label>
            <input type="text" id="modal-project-name" class="form-input" required placeholder="เช่น โครงการก่อสร้างสะพานข้ามแยก B" />
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label"><i class="fa-solid fa-briefcase"></i> ชื่อบริษัท / ผู้รับเหมาหลัก</label>
              <input type="text" id="modal-project-company" class="form-input" placeholder="เช่น บริษัท ก่อสร้างไทย เอ็นจิเนียริ่ง จำกัด" />
            </div>
            <div class="form-group">
              <label class="form-label"><i class="fa-solid fa-user-tie"></i> ชื่อผู้ควบคุมงาน / Site Engineer</label>
              <input type="text" id="modal-project-supervisor" class="form-input" placeholder="เช่น นายสมศักดิ์ วงศ์สวัสดิ์" />
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> บันทึกโครงการ</button>
          </div>
        </form>
      </div>
    </div>
  `;
  openModal(modalHtml);
}

function openEditProjectModal(projectId) {
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const proj = projects.find(p => p.id === projectId);
  if (!proj) return;

  const modalHtml = `
    <div class="modal-backdrop">
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3><i class="fa-solid fa-pen" style="color:var(--primary);"></i> แก้ไขข้อมูลโครงการ</h3>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <form class="modal-body" onsubmit="saveProjectForm(event, '${projectId}')">
          <div class="form-group">
            <label class="form-label"><i class="fa-solid fa-building"></i> ชื่อโครงการ / ไซต์งาน *</label>
            <input type="text" id="modal-project-name" class="form-input" required value="${proj.name}" />
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label"><i class="fa-solid fa-briefcase"></i> ชื่อบริษัท / ผู้รับเหมาหลัก</label>
              <input type="text" id="modal-project-company" class="form-input" value="${proj.companyName || ''}" />
            </div>
            <div class="form-group">
              <label class="form-label"><i class="fa-solid fa-user-tie"></i> ชื่อผู้ควบคุมงาน / Site Engineer</label>
              <input type="text" id="modal-project-supervisor" class="form-input" value="${proj.supervisorName || ''}" />
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> อัปเดตโครงการ</button>
          </div>
        </form>
      </div>
    </div>
  `;
  openModal(modalHtml);
}

function saveProjectForm(event, editingId = null) {
  event.preventDefault();
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const name = document.getElementById('modal-project-name').value.trim();
  const companyName = document.getElementById('modal-project-company').value.trim();
  const supervisorName = document.getElementById('modal-project-supervisor').value.trim();

  if (!name) return;

  if (editingId) {
    const idx = projects.findIndex(p => p.id === editingId);
    if (idx !== -1) {
      projects[idx] = { ...projects[idx], name, companyName, supervisorName };
    }
  } else {
    const newProj = {
      id: `proj-${Date.now()}`,
      name,
      companyName: companyName || 'บริษัทผู้รับเหมา',
      supervisorName: supervisorName || 'วิศวกรผู้ควบคุมงาน',
      color: '#2563eb'
    };
    projects.push(newProj);
    state.activeProjectId = newProj.id;
  }

  setStorage(DB_KEYS.PROJECTS, projects);
  closeModal();
  renderNavBars();
  renderCurrentPage();
  showToast(`${editingId ? 'แก้ไข' : 'เพิ่ม'}โครงการ "${name}" สำเร็จ`, 'success');
}

function deleteProject(projectId) {
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  if (projects.length <= 1) {
    alert('ต้องมีโครงการอย่างน้อย 1 โครงการในระบบ');
    return;
  }

  if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบโครงการนี้? (คนงานในโครงการจะถูกย้ายไปโครงการอื่น)')) return;

  const filtered = projects.filter(p => p.id !== projectId);
  setStorage(DB_KEYS.PROJECTS, filtered);
  if (state.activeProjectId === projectId) {
    state.activeProjectId = filtered[0].id;
  }

  renderNavBars();
  renderCurrentPage();
  showToast('ลบโครงการเรียบร้อยแล้ว', 'warning');
}

// ─── Worker Photo Quick Setter Modal ──────────────────────────────────────────

function openPhotoModal(empId) {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  state.photoModalTempAvatar = emp.avatar || '';

  const modalHtml = `
    <div class="modal-backdrop">
      <div class="modal-box">
        <div class="modal-header">
          <h3><i class="fa-solid fa-camera" style="color:var(--primary);"></i> ตั้งค่ารูปถ่าย: ${emp.firstName} ${emp.lastName}</h3>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
          <div style="display:flex;flex-direction:column;align-items:center;gap:0.65rem;padding:0.85rem;background:var(--bg-app);border-radius:var(--radius-lg);border:1.5px dashed var(--border-color);">
            <img id="photo-modal-preview" src="${getEmployeeAvatar(emp, 80)}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #fff;box-shadow:var(--shadow-md);" />
            
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;justify-content:center;">
              <label class="btn btn-primary btn-sm" style="cursor:pointer;">
                <i class="fa-solid fa-camera"></i> ถ่ายภาพ
                <input type="file" accept="image/*" capture="environment" style="display:none;" onchange="handlePhotoModalFile(event)" />
              </label>

              <label class="btn btn-outline btn-sm" style="cursor:pointer;">
                <i class="fa-solid fa-image"></i> เลือกรูป
                <input type="file" accept="image/*" style="display:none;" onchange="handlePhotoModalFile(event)" />
              </label>

              <button type="button" class="btn btn-outline btn-sm" onclick="resetPhotoModalAvatar('${emp.firstName}')">
                <i class="fa-solid fa-rotate-left"></i> อักษรย่อ
              </button>
            </div>
          </div>

          <div>
            <label class="form-label" style="margin-bottom:0.3rem;display:block;"><i class="fa-solid fa-icons"></i> หรือเลือกรูปภาพสำเร็จรูป:</label>
            <div class="avatar-presets-grid">
              ${AVATAR_PRESETS.map(preset => `
                <div class="avatar-preset-item" onclick="selectPhotoPreset('${preset.url}')">
                  <img src="${preset.url}" alt="${preset.name}" />
                  <span>${preset.name}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
          <button type="button" class="btn btn-primary" onclick="saveWorkerPhoto('${empId}')"><i class="fa-solid fa-floppy-disk"></i> บันทึกรูปถ่าย</button>
        </div>
      </div>
    </div>
  `;
  openModal(modalHtml);
}

function handlePhotoModalFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > 3 * 1024 * 1024) {
    alert('ขนาดรูปภาพต้องไม่เกิน 3MB');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    state.photoModalTempAvatar = e.target.result;
    const preview = document.getElementById('photo-modal-preview');
    if (preview) preview.src = state.photoModalTempAvatar;
  };
  reader.readAsDataURL(file);
}

function selectPhotoPreset(url) {
  state.photoModalTempAvatar = url;
  const preview = document.getElementById('photo-modal-preview');
  if (preview) preview.src = url;
}

function resetPhotoModalAvatar(firstName) {
  state.photoModalTempAvatar = '';
  const preview = document.getElementById('photo-modal-preview');
  if (preview) preview.src = getInitialsAvatar(firstName, 80);
}

function saveWorkerPhoto(empId) {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  emp.avatar = state.photoModalTempAvatar;
  setStorage(DB_KEYS.EMPLOYEES, employees);

  closeModal();
  renderCurrentPage();
  showToast(`อัปเดตรูปถ่ายของ "${emp.firstName} ${emp.lastName}" เรียบร้อยแล้ว`, 'success');
}

function openMobileDrawer() {
  document.getElementById('drawerOverlay').classList.add('active');
  document.getElementById('drawer').classList.add('active');
}

function closeMobileDrawer() {
  document.getElementById('drawerOverlay').classList.remove('active');
  document.getElementById('drawer').classList.remove('active');
}

function navigateTo(viewId, params = {}) {
  state.currentView = viewId;
  closeMobileDrawer();
  renderNavBars();

  if (viewId === 'history' && params.empId) {
    state.selectedEmployeeId = params.empId;
  }

  renderCurrentPage();
}

function startLiveClock() {
  function update() {
    const el = document.getElementById('clock-text');
    if (el) {
      const now = new Date();
      el.textContent = now.toLocaleTimeString('th-TH');
    }
  }
  update();
  setInterval(update, 1000);
}

// ─── VIEW 1: DAILY ATTENDANCE (CORE CHECK-IN WITH DUAL VIEW MODES) ────────────

function renderAttendanceView() {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const teams = getStorage(DB_KEYS.TEAMS) || [];
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const teamMap = {};
  teams.forEach(t => teamMap[t.id] = t);
  const projectMap = {};
  projects.forEach(p => projectMap[p.id] = p);

  // Filter by active project if selected
  let projectEmps = employees.filter(e => e.isActive);
  if (state.activeProjectId !== 'all') {
    projectEmps = projectEmps.filter(e => e.projectId === state.activeProjectId);
  }

  const allAttendance = getStorage(DB_KEYS.ATTENDANCE) || {};

  // Compute status counts
  let counts = { total: projectEmps.length, present: 0, late: 0, leave: 0, absent: 0, field: 0, unchecked: 0 };
  projectEmps.forEach(emp => {
    const key = `${emp.id}_${state.currentDate}`;
    const record = allAttendance[key];
    const status = record ? record.status : 'unchecked';
    if (counts[status] !== undefined) counts[status]++;
    else counts.unchecked++;
  });

  // Filter available teams for dropdown (only teams in selected project)
  const availableTeams = state.activeProjectId === 'all' 
    ? teams 
    : teams.filter(t => t.projectId === state.activeProjectId);

  // Apply filters & search
  let filtered = projectEmps.filter(emp => {
    if (state.filterTeam !== 'all' && emp.teamId !== state.filterTeam) return false;
    
    const key = `${emp.id}_${state.currentDate}`;
    const record = allAttendance[key];
    const status = record ? record.status : 'unchecked';
    if (state.filterStatus !== 'all' && status !== state.filterStatus) return false;

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const matchName = `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(q);
      const matchNick = (emp.nickname || '').toLowerCase().includes(q);
      const matchId = emp.id.toLowerCase().includes(q);
      const matchPos = (emp.position || '').toLowerCase().includes(q);
      if (!matchName && !matchNick && !matchId && !matchPos) return false;
    }
    return true;
  });

  const activeProjObj = projects.find(p => p.id === state.activeProjectId);
  const projTitle = activeProjObj ? activeProjObj.name : 'ทุกโครงการ';

  return `
    <div class="att-sticky-header">
      <div class="att-header-top">
        <div>
          <h2 class="page-title">
            <i class="fa-solid fa-clipboard-check"></i> เช็คชื่อรายวัน
          </h2>
          <div class="page-subtitle">
            <span>${formatThaiFullDate(state.currentDate)}</span> • 
            <strong style="color:var(--primary);">${projTitle}</strong>
          </div>
        </div>

        <div class="att-controls-row">
          <!-- View Mode Switcher -->
          <div class="view-mode-toggle">
            <button class="view-mode-btn ${state.viewMode === 'list' ? 'active' : ''}" onclick="setAttendanceViewMode('list')" title="แบบลำดับรายชื่อ (เร็วสำหรับมือถือ)">
              <i class="fa-solid fa-list-ol"></i> ลำดับรายชื่อ
            </button>
            <button class="view-mode-btn ${state.viewMode === 'grid' ? 'active' : ''}" onclick="setAttendanceViewMode('grid')" title="แบบแผงการ์ด">
              <i class="fa-solid fa-table-cells-large"></i> แผงการ์ด
            </button>
          </div>

          <input type="date" class="date-picker-input" value="${state.currentDate}" onchange="changeAttendanceDate(this.value)" />
          
          <button class="btn btn-success btn-sm" onclick="batchCheckAllPresent()" title="เช็คคนที่ยังไม่เช็คเป็นมาทำงาน">
            <i class="fa-solid fa-check-double"></i> <span>เช็คทั้งหมด</span>
          </button>
        </div>
      </div>

      <!-- Quick Summary Filter Chips -->
      <div class="att-summary-bar">
        <div class="att-sum-item ${state.filterStatus === 'all' ? 'active' : ''}" onclick="setAttendanceFilterStatus('all')">
          <span class="att-sum-num">${counts.total}</span>
          <span class="att-sum-label">ทั้งหมด</span>
        </div>
        <div class="att-sum-item ${state.filterStatus === 'present' ? 'active' : ''}" onclick="setAttendanceFilterStatus('present')">
          <span class="att-sum-num" style="color:var(--color-present);">${counts.present}</span>
          <span class="att-sum-label">มาทำงาน</span>
        </div>
        <div class="att-sum-item ${state.filterStatus === 'late' ? 'active' : ''}" onclick="setAttendanceFilterStatus('late')">
          <span class="att-sum-num" style="color:var(--color-late);">${counts.late}</span>
          <span class="att-sum-label">มาสาย</span>
        </div>
        <div class="att-sum-item ${state.filterStatus === 'leave' ? 'active' : ''}" onclick="setAttendanceFilterStatus('leave')">
          <span class="att-sum-num" style="color:var(--color-leave);">${counts.leave}</span>
          <span class="att-sum-label">ลางาน</span>
        </div>
        <div class="att-sum-item ${state.filterStatus === 'absent' ? 'active' : ''}" onclick="setAttendanceFilterStatus('absent')">
          <span class="att-sum-num" style="color:var(--color-absent);">${counts.absent}</span>
          <span class="att-sum-label">ขาดงาน</span>
        </div>
        <div class="att-sum-item ${state.filterStatus === 'field' ? 'active' : ''}" onclick="setAttendanceFilterStatus('field')">
          <span class="att-sum-num" style="color:var(--color-field);">${counts.field}</span>
          <span class="att-sum-label">นอกไซต์</span>
        </div>
      </div>

      <!-- Filter & Search Toolbar -->
      <div class="att-filters-toolbar">
        <div class="search-input-wrap">
          <i class="fa-solid fa-search"></i>
          <input type="text" class="search-input" placeholder="ค้นหาชื่อ, รหัส, ตำแหน่ง..." value="${state.searchQuery}" oninput="handleSearchInput(this.value)" />
        </div>
        <select class="filter-select" onchange="handleTeamFilter(this.value)">
          <option value="all">ทุกชุดทีมงาน (${availableTeams.length})</option>
          ${availableTeams.map(t => `<option value="${t.id}" ${state.filterTeam === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
        </select>
      </div>
    </div>

    ${filtered.length === 0 ? `
      <div class="empty-state">
        <i class="fa-solid fa-users-slash"></i>
        <h3>ไม่พบรายชื่อคนงานตามเงื่อนไขที่เลือก</h3>
        <p>ลองเปลี่ยนคำค้นหา หรือเลือกตัวกรอง "ทั้งหมด"</p>
      </div>
    ` : state.viewMode === 'list' ? renderSequentialListView(filtered, allAttendance, teamMap, projectMap) : renderPanelGridView(filtered, allAttendance, teamMap, projectMap)}
  `;
}

function setAttendanceViewMode(mode) {
  state.viewMode = mode;
  renderCurrentPage();
}

// ─── MODE A: SEQUENTIAL LIST VIEW (แบบลำดับรายชื่อเรียงสำหรับมือถือ) ─────────

function renderSequentialListView(employees, allAttendance, teamMap, projectMap) {
  return `
    <div class="att-list-rows-container">
      ${employees.map((emp, idx) => {
        const key = `${emp.id}_${state.currentDate}`;
        const record = allAttendance[key];
        const status = record ? record.status : 'unchecked';
        const team = teamMap[emp.teamId];
        const avatarUrl = getEmployeeAvatar(emp, 38);
        const stCfg = STATUS_CONFIG[status] || STATUS_CONFIG.unchecked;

        return `
          <div class="att-list-row-item" style="border-left: 4px solid ${stCfg.color};" id="row-${emp.id}">
            <div class="att-list-row-main">
              <span class="att-row-seq">#${idx + 1}</span>
              <img src="${avatarUrl}" class="att-row-avatar" onclick="openPhotoModal('${emp.id}')" title="แตะเพื่อเปลี่ยนรูป" onerror="this.src='${getInitialsAvatar(emp.firstName, 38)}'" />
              
              <div class="att-row-info" onclick="navigateTo('history', { empId: '${emp.id}' })">
                <div class="att-row-name">
                  <span>${emp.firstName} ${emp.lastName}</span>
                  ${emp.nickname ? `<span class="att-emp-nick">(${emp.nickname})</span>` : ''}
                </div>
                <div class="att-row-meta">
                  <span>${emp.id}</span>
                  ${team ? `<span>• <strong style="color:${team.color};">${team.name}</strong></span>` : ''}
                  <span>• ${emp.position || 'คนงาน'}</span>
                </div>
              </div>

              <div>
                <span class="status-badge status-${status}">
                  ${stCfg.label}
                </span>
              </div>
            </div>

            <!-- Quick Status Tap Row for Mobile -->
            <div class="att-row-status-strip">
              <button type="button" class="att-btn-status btn-present ${status === 'present' ? 'active' : ''}" onclick="quickCheckIn('${emp.id}', 'present')">
                <i class="fa-solid fa-circle-check"></i>
                <span>มา</span>
              </button>
              <button type="button" class="att-btn-status btn-late ${status === 'late' ? 'active' : ''}" onclick="quickCheckIn('${emp.id}', 'late')">
                <i class="fa-solid fa-clock"></i>
                <span>สาย</span>
              </button>
              <button type="button" class="att-btn-status btn-leave ${status === 'leave' ? 'active' : ''}" onclick="openLeaveModal('${emp.id}')">
                <i class="fa-solid fa-calendar-minus"></i>
                <span>ลา</span>
              </button>
              <button type="button" class="att-btn-status btn-absent ${status === 'absent' ? 'active' : ''}" onclick="openAbsentModal('${emp.id}')">
                <i class="fa-solid fa-circle-xmark"></i>
                <span>ขาด</span>
              </button>
              <button type="button" class="att-btn-status btn-field ${status === 'field' ? 'active' : ''}" onclick="openFieldModal('${emp.id}')">
                <i class="fa-solid fa-location-dot"></i>
                <span>นอกไซต์</span>
              </button>
            </div>

            <div class="att-card-details-row">
              <div class="att-time-badge">
                <i class="fa-regular fa-clock"></i>
                <span>${record && record.checkIn ? `${record.checkIn} - ${record.checkOut || '17:30'}` : 'เวลามาตรฐาน'}</span>
                ${record && parseFloat(record.otHours || 0) > 0 ? `<span style="color:var(--color-late);font-weight:700;">(OT ${record.otHours} ชม.)</span>` : ''}
              </div>
              <div class="att-note-preview">
                ${record && record.note ? record.note : (record && record.location ? `📍 ${record.location}` : '')}
              </div>
              <div class="att-card-btns-wrap">
                <button class="att-photo-btn" onclick="openPhotoModal('${emp.id}')">
                  <i class="fa-solid fa-camera"></i> รูป
                </button>
                <button class="att-edit-btn" onclick="openEditAttendanceModal('${emp.id}')">
                  <i class="fa-solid fa-pen-to-square"></i> แก้ไข
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ─── MODE B: PANEL GRID VIEW (แบบแผงการ์ด) ────────────────────────────────────

function renderPanelGridView(employees, allAttendance, teamMap, projectMap) {
  return `
    <div class="att-cards-grid">
      ${employees.map(emp => {
        const key = `${emp.id}_${state.currentDate}`;
        const record = allAttendance[key];
        const status = record ? record.status : 'unchecked';
        const team = teamMap[emp.teamId];
        const avatarUrl = getEmployeeAvatar(emp, 48);
        const stCfg = STATUS_CONFIG[status] || STATUS_CONFIG.unchecked;

        return `
          <div class="att-card status-border-${status}" id="card-${emp.id}">
            <div class="att-card-top">
              <div class="att-emp-avatar-wrap" onclick="openPhotoModal('${emp.id}')" title="คลิกเพื่อเปลี่ยนรูปถ่าย">
                <img src="${avatarUrl}" alt="${emp.firstName}" class="att-emp-avatar" onerror="this.src='${getInitialsAvatar(emp.firstName, 48)}'" />
                <span class="att-emp-avatar-badge" style="background:${stCfg.color};"></span>
              </div>
              <div class="att-emp-info" onclick="navigateTo('history', { empId: '${emp.id}' })">
                <div class="att-emp-name-row">
                  <span class="att-emp-name">${emp.firstName} ${emp.lastName}</span>
                  ${emp.nickname ? `<span class="att-emp-nick">(${emp.nickname})</span>` : ''}
                </div>
                <div class="att-emp-meta">
                  <span>${emp.id}</span>
                  ${team ? `<span>• <strong style="color:${team.color};">${team.name}</strong></span>` : ''}
                </div>
                <div class="att-emp-pos"><i class="fa-solid fa-briefcase"></i> ${emp.position || '-'}</div>
              </div>
              <div>
                <span class="status-badge status-${status}">
                  <i class="fa-solid ${stCfg.icon}"></i> ${stCfg.label}
                </span>
              </div>
            </div>

            <div class="att-status-actions-grid">
              <button type="button" class="att-btn-status btn-present ${status === 'present' ? 'active' : ''}" onclick="quickCheckIn('${emp.id}', 'present')">
                <i class="fa-solid fa-circle-check"></i>
                <span>มาทำงาน</span>
              </button>
              <button type="button" class="att-btn-status btn-late ${status === 'late' ? 'active' : ''}" onclick="quickCheckIn('${emp.id}', 'late')">
                <i class="fa-solid fa-clock"></i>
                <span>มาสาย</span>
              </button>
              <button type="button" class="att-btn-status btn-leave ${status === 'leave' ? 'active' : ''}" onclick="openLeaveModal('${emp.id}')">
                <i class="fa-solid fa-calendar-minus"></i>
                <span>ลางาน</span>
              </button>
              <button type="button" class="att-btn-status btn-absent ${status === 'absent' ? 'active' : ''}" onclick="openAbsentModal('${emp.id}')">
                <i class="fa-solid fa-circle-xmark"></i>
                <span>ขาดงาน</span>
              </button>
              <button type="button" class="att-btn-status btn-field ${status === 'field' ? 'active' : ''}" onclick="openFieldModal('${emp.id}')">
                <i class="fa-solid fa-location-dot"></i>
                <span>นอกไซต์</span>
              </button>
            </div>

            <div class="att-card-details-row">
              <div class="att-time-badge">
                <i class="fa-regular fa-clock"></i>
                <span>${record && record.checkIn ? `${record.checkIn} - ${record.checkOut || '17:30'}` : 'เวลามาตรฐาน'}</span>
                ${record && parseFloat(record.otHours || 0) > 0 ? `<span style="color:var(--color-late);font-weight:700;">(OT ${record.otHours} ชม.)</span>` : ''}
              </div>
              <div class="att-note-preview">
                ${record && record.note ? record.note : (record && record.location ? `📍 ${record.location}` : '')}
              </div>
              <div class="att-card-btns-wrap">
                <button class="att-photo-btn" onclick="openPhotoModal('${emp.id}')">
                  <i class="fa-solid fa-camera"></i> รูป
                </button>
                <button class="att-edit-btn" onclick="openEditAttendanceModal('${emp.id}')">
                  <i class="fa-solid fa-pen-to-square"></i> แก้ไข
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function changeAttendanceDate(newDate) {
  state.currentDate = newDate;
  renderCurrentPage();
  showToast(`สลับดูวันที่ ${formatThaiDate(newDate)}`, 'info');
}

function handleSearchInput(val) {
  state.searchQuery = val.trim();
  renderCurrentPage();
}

function handleTeamFilter(val) {
  state.filterTeam = val;
  renderCurrentPage();
}

function setAttendanceFilterStatus(val) {
  state.filterStatus = val;
  renderCurrentPage();
}

function quickCheckIn(empId, status) {
  const all = getStorage(DB_KEYS.ATTENDANCE) || {};
  const key = `${empId}_${state.currentDate}`;
  const prevRecord = all[key] ? { ...all[key] } : null;

  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const emp = employees.find(e => e.id === empId);

  let checkInTime = '07:30';
  let checkOutTime = '17:30';
  if (status === 'late') checkInTime = '08:15';

  const record = {
    employeeId: empId,
    date: state.currentDate,
    status: status,
    checkIn: checkInTime,
    checkOut: checkOutTime,
    otHours: (prevRecord && prevRecord.otHours) || '0',
    leaveType: '',
    location: '',
    note: (prevRecord && prevRecord.note) || ''
  };

  all[key] = record;
  setStorage(DB_KEYS.ATTENDANCE, all);

  renderCurrentPage();

  const empName = emp ? `${emp.firstName}` : empId;
  const statusLabel = STATUS_CONFIG[status].label;
  showToast(`${empName} -> ${statusLabel}`, 'success', () => {
    const curAll = getStorage(DB_KEYS.ATTENDANCE) || {};
    if (prevRecord) {
      curAll[key] = prevRecord;
    } else {
      delete curAll[key];
    }
    setStorage(DB_KEYS.ATTENDANCE, curAll);
    renderCurrentPage();
  });
}

function batchCheckAllPresent() {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  let activeEmps = employees.filter(e => e.isActive);
  if (state.activeProjectId !== 'all') {
    activeEmps = activeEmps.filter(e => e.projectId === state.activeProjectId);
  }

  const all = getStorage(DB_KEYS.ATTENDANCE) || {};
  const unchecked = activeEmps.filter(emp => {
    const key = `${emp.id}_${state.currentDate}`;
    return !all[key] || all[key].status === 'unchecked';
  });

  if (unchecked.length === 0) {
    showToast('ทุกคนในรายการเช็คชื่อเรียบร้อยแล้ว', 'warning');
    return;
  }

  if (!confirm(`ต้องการเช็คชื่อคนที่ยังไม่เช็ค (${unchecked.length} คน) เป็น "มาทำงาน" ทั้งหมดหรือไม่?`)) return;

  unchecked.forEach(emp => {
    const key = `${emp.id}_${state.currentDate}`;
    all[key] = {
      employeeId: emp.id,
      date: state.currentDate,
      status: 'present',
      checkIn: '07:30',
      checkOut: '17:30',
      otHours: '0',
      note: ''
    };
  });

  setStorage(DB_KEYS.ATTENDANCE, all);
  renderCurrentPage();
  showToast(`เช็คชื่อพนักงาน ${unchecked.length} คนเป็น "มาทำงาน" เรียบร้อยแล้ว`, 'success');
}

// ─── ATTENDANCE DETAIL MODALS (Edit Time/OT, Leave, Absent, Field) ────────────

function openEditAttendanceModal(empId) {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  const all = getStorage(DB_KEYS.ATTENDANCE) || {};
  const key = `${empId}_${state.currentDate}`;
  const record = all[key] || {
    status: 'present',
    checkIn: '07:30',
    checkOut: '17:30',
    otHours: '0',
    note: '',
    location: ''
  };

  const modalHtml = `
    <div class="modal-backdrop">
      <div class="modal-box">
        <div class="modal-header">
          <h3><i class="fa-solid fa-clock"></i> ลงเวลา & OT: ${emp.firstName} ${emp.lastName}</h3>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <form class="modal-body" onsubmit="saveAttendanceDetail(event, '${empId}')">
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label"><i class="fa-solid fa-user-check"></i> สถานะการทำงาน</label>
              <select id="modal-att-status" class="form-select">
                <option value="present" ${record.status === 'present' ? 'selected' : ''}>🟢 มาทำงาน</option>
                <option value="late" ${record.status === 'late' ? 'selected' : ''}>🟡 มาสาย</option>
                <option value="leave" ${record.status === 'leave' ? 'selected' : ''}>🟣 ลางาน</option>
                <option value="absent" ${record.status === 'absent' ? 'selected' : ''}>🔴 ขาดงาน</option>
                <option value="field" ${record.status === 'field' ? 'selected' : ''}>🔵 นอกสถานที่</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label"><i class="fa-solid fa-bolt" style="color:var(--color-late);"></i> จำนวนชั่วโมง OT</label>
              <input type="number" step="0.5" min="0" max="12" id="modal-att-ot" class="form-input" value="${record.otHours || '0'}" placeholder="เช่น 1.5, 2.0" />
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label"><i class="fa-solid fa-arrow-right-to-bracket"></i> เวลาเข้างาน</label>
              <input type="time" id="modal-att-in" class="form-input" value="${record.checkIn || '07:30'}" />
            </div>
            <div class="form-group">
              <label class="form-label"><i class="fa-solid fa-arrow-right-from-bracket"></i> เวลาออกงาน</label>
              <input type="time" id="modal-att-out" class="form-input" value="${record.checkOut || '17:30'}" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label"><i class="fa-solid fa-location-dot"></i> สถานที่ (กรณีนอกไซต์งาน)</label>
            <input type="text" id="modal-att-location" class="form-input" value="${record.location || ''}" placeholder="ระบุไซต์งาน หรือสถานที่ปฏิบัติงาน" />
          </div>

          <div class="form-group">
            <label class="form-label"><i class="fa-regular fa-comment-dots"></i> หมายเหตุ / ภารกิจที่ได้รับมอบหมาย</label>
            <textarea id="modal-att-note" class="form-input" rows="2" placeholder="เช่น เทปูนชั้น 3, เชื่อมโครงหลังคา">${record.note || ''}</textarea>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> บันทึกเวลา</button>
          </div>
        </form>
      </div>
    </div>
  `;
  openModal(modalHtml);
}

function saveAttendanceDetail(event, empId) {
  event.preventDefault();
  const all = getStorage(DB_KEYS.ATTENDANCE) || {};
  const key = `${empId}_${state.currentDate}`;

  all[key] = {
    employeeId: empId,
    date: state.currentDate,
    status: document.getElementById('modal-att-status').value,
    checkIn: document.getElementById('modal-att-in').value,
    checkOut: document.getElementById('modal-att-out').value,
    otHours: document.getElementById('modal-att-ot').value || '0',
    location: document.getElementById('modal-att-location').value.trim(),
    note: document.getElementById('modal-att-note').value.trim()
  };

  setStorage(DB_KEYS.ATTENDANCE, all);
  closeModal();
  renderCurrentPage();
  showToast('บันทึกรายละเอียดเวลาทำงานเรียบร้อยแล้ว', 'success');
}

function openLeaveModal(empId) {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const emp = employees.find(e => e.id === empId);
  const modalHtml = `
    <div class="modal-backdrop">
      <div class="modal-box modal-sm">
        <div class="modal-header">
          <h3><i class="fa-solid fa-calendar-minus" style="color:var(--color-leave);"></i> บันทึกลางาน: ${emp ? emp.firstName : ''}</h3>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <form class="modal-body" onsubmit="saveLeaveAction(event, '${empId}')">
          <div class="form-group">
            <label class="form-label">ประเภทการลา</label>
            <select id="modal-leave-type" class="form-select">
              <option value="sick">ลาป่วย</option>
              <option value="personal">ลากิจ</option>
              <option value="vacation">ลาพักร้อน</option>
              <option value="other">ลาอื่น ๆ</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">หมายเหตุ / เหตุผลการลา</label>
            <textarea id="modal-leave-note" class="form-input" rows="3" placeholder="ระบุเหตุผลการลา (เช่น มีใบรับรองแพทย์, ติดธุระด่วน)"></textarea>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check"></i> ยืนยันการลา</button>
          </div>
        </form>
      </div>
    </div>
  `;
  openModal(modalHtml);
}

function saveLeaveAction(event, empId) {
  event.preventDefault();
  const all = getStorage(DB_KEYS.ATTENDANCE) || {};
  const key = `${empId}_${state.currentDate}`;
  const leaveType = document.getElementById('modal-leave-type').value;
  const note = document.getElementById('modal-leave-note').value.trim();

  all[key] = {
    employeeId: empId,
    date: state.currentDate,
    status: 'leave',
    checkIn: '',
    checkOut: '',
    leaveType: leaveType,
    note: `${LEAVE_TYPES[leaveType] || 'ลางาน'}: ${note}`
  };

  setStorage(DB_KEYS.ATTENDANCE, all);
  closeModal();
  renderCurrentPage();
  showToast('บันทึกการลางานเรียบร้อยแล้ว', 'success');
}

function openAbsentModal(empId) {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const emp = employees.find(e => e.id === empId);
  const modalHtml = `
    <div class="modal-backdrop">
      <div class="modal-box modal-sm">
        <div class="modal-header">
          <h3><i class="fa-solid fa-circle-xmark" style="color:var(--color-absent);"></i> บันทึกขาดงาน: ${emp ? emp.firstName : ''}</h3>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <form class="modal-body" onsubmit="saveAbsentAction(event, '${empId}')">
          <div class="form-group">
            <label class="form-label">เหตุผล / หมายเหตุ</label>
            <textarea id="modal-absent-note" class="form-input" rows="3" placeholder="เช่น ไม่แจ้งล่วงหน้า, ติดต่อไม่ได้"></textarea>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
            <button type="submit" class="btn btn-danger"><i class="fa-solid fa-circle-xmark"></i> บันทึกขาดงาน</button>
          </div>
        </form>
      </div>
    </div>
  `;
  openModal(modalHtml);
}

function saveAbsentAction(event, empId) {
  event.preventDefault();
  const all = getStorage(DB_KEYS.ATTENDANCE) || {};
  const key = `${empId}_${state.currentDate}`;
  const note = document.getElementById('modal-absent-note').value.trim() || 'ไม่แจ้งล่วงหน้า';

  all[key] = {
    employeeId: empId,
    date: state.currentDate,
    status: 'absent',
    checkIn: '',
    checkOut: '',
    note: note
  };

  setStorage(DB_KEYS.ATTENDANCE, all);
  closeModal();
  renderCurrentPage();
  showToast('บันทึกขาดงานเรียบร้อยแล้ว', 'warning');
}

function openFieldModal(empId) {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const emp = employees.find(e => e.id === empId);
  const modalHtml = `
    <div class="modal-backdrop">
      <div class="modal-box modal-sm">
        <div class="modal-header">
          <h3><i class="fa-solid fa-location-dot" style="color:var(--color-field);"></i> ปฏิบัติงานนอกสถานที่: ${emp ? emp.firstName : ''}</h3>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <form class="modal-body" onsubmit="saveFieldAction(event, '${empId}')">
          <div class="form-group">
            <label class="form-label">สถานที่ปฏิบัติงาน *</label>
            <input type="text" id="modal-field-location" class="form-input" required placeholder="เช่น ไปตรวจงานอาคาร B สาขาสาทร" />
          </div>
          <div class="form-group">
            <label class="form-label">รายละเอียดภารกิจ</label>
            <textarea id="modal-field-note" class="form-input" rows="2" placeholder="ระบุเนื้องานที่ต้องทำ"></textarea>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-location-dot"></i> บันทึกนอกสถานที่</button>
          </div>
        </form>
      </div>
    </div>
  `;
  openModal(modalHtml);
}

function saveFieldAction(event, empId) {
  event.preventDefault();
  const all = getStorage(DB_KEYS.ATTENDANCE) || {};
  const key = `${empId}_${state.currentDate}`;
  const location = document.getElementById('modal-field-location').value.trim();
  const note = document.getElementById('modal-field-note').value.trim();

  all[key] = {
    employeeId: empId,
    date: state.currentDate,
    status: 'field',
    checkIn: '07:30',
    checkOut: '17:30',
    location: location,
    note: note
  };

  setStorage(DB_KEYS.ATTENDANCE, all);
  closeModal();
  renderCurrentPage();
  showToast('บันทึกปฏิบัติงานนอกสถานที่เรียบร้อยแล้ว', 'success');
}

// ─── VIEW 2: PROJECTS & TEAMS HIERARCHY OVERVIEW ──────────────────────────────

function renderProjectsTeamsView() {
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const teams = getStorage(DB_KEYS.TEAMS) || [];
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const activeEmps = employees.filter(e => e.isActive);

  return `
    <div class="page-header">
      <div>
        <h2 class="page-title"><i class="fa-solid fa-sitemap"></i> ภาพรวมโครงการ & ทีมงาน</h2>
        <p class="page-subtitle">จัดการโครงสร้างโครงการ ทีมงาน และดูจำนวนคนงานแบบแยกตามโครงการ/ทีม</p>
      </div>
      <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" onclick="openAddProjectModal()">
          <i class="fa-solid fa-folder-plus"></i> เพิ่มโครงการ
        </button>
        <button class="btn btn-outline btn-sm" onclick="openAddTeamModal()">
          <i class="fa-solid fa-plus"></i> เพิ่มทีมงาน
        </button>
      </div>
    </div>

    <!-- Multi-Project & Team Summary Grid -->
    <div class="proj-team-breakdown-grid">
      ${projects.map(proj => {
        const projTeams = teams.filter(t => t.projectId === proj.id);
        const projEmps = activeEmps.filter(e => e.projectId === proj.id);

        return `
          <div class="proj-card">
            <div class="proj-card-header">
              <div>
                <div class="proj-card-title"><i class="fa-solid fa-building" style="color:var(--primary);"></i> ${proj.name}</div>
                <div class="proj-card-company">${proj.companyName || '-'} • ${proj.supervisorName || '-'}</div>
              </div>
              <div style="display:flex;gap:0.25rem;">
                <button class="btn btn-outline btn-sm" onclick="openEditProjectModal('${proj.id}')" title="แก้ไขโครงการ"><i class="fa-regular fa-pen-to-square"></i></button>
                <button class="btn btn-outline btn-sm" style="color:var(--color-absent);" onclick="deleteProject('${proj.id}')" title="ลบโครงการ"><i class="fa-regular fa-trash-can"></i></button>
              </div>
            </div>

            <div style="display:flex;gap:0.5rem;align-items:center;background:var(--bg-app);padding:0.5rem 0.75rem;border-radius:var(--radius-md);border:1px solid var(--border-color);">
              <div style="font-size:1.35rem;font-weight:800;color:var(--primary);">${projEmps.length}</div>
              <div style="font-size:0.76rem;color:var(--text-muted);">คนงานในโครงการนี้ (${projTeams.length} ชุดทีมงาน)</div>
              <div style="margin-left:auto;">
                <button class="btn btn-sm btn-primary" onclick="changeActiveProject('${proj.id}');navigateTo('attendance');">
                  <i class="fa-solid fa-arrow-right"></i> เปิดเช็คชื่อ
                </button>
              </div>
            </div>

            <!-- Teams in Project -->
            <div style="display:flex;flex-direction:column;gap:0.35rem;margin-top:0.25rem;">
              <div style="font-size:0.75rem;font-weight:700;color:var(--text-muted);"><i class="fa-solid fa-people-group"></i> ชุดทีมงานในโครงการ:</div>
              ${projTeams.length === 0 ? `
                <div style="font-size:0.74rem;color:var(--text-light);padding:0.4rem;background:var(--bg-app);border-radius:var(--radius-sm);">ยังไม่มีทีมงานในโครงการนี้ <a href="javascript:void(0)" onclick="openAddTeamModal('${proj.id}')" style="color:var(--primary);font-weight:600;">+ เพิ่มทีม</a></div>
              ` : projTeams.map(t => {
                const teamEmps = projEmps.filter(e => e.teamId === t.id);
                return `
                  <div class="proj-team-pill" style="border-left:4px solid ${t.color || 'var(--primary)'};">
                    <div>
                      <strong>${t.name}</strong>
                      <span style="font-size:0.7rem;color:var(--text-muted);margin-left:0.25rem;">(${t.description || '-'})</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:0.4rem;">
                      <span style="font-weight:800;color:${t.color || 'var(--primary)'};">${teamEmps.length} คน</span>
                      <button class="btn btn-outline btn-sm" style="padding:0.15rem 0.35rem;font-size:0.7rem;" onclick="openEditTeamModal('${t.id}')"><i class="fa-regular fa-pen-to-square"></i></button>
                      <button class="btn btn-outline btn-sm" style="padding:0.15rem 0.35rem;font-size:0.7rem;color:var(--color-absent);" onclick="deleteTeam('${t.id}')"><i class="fa-regular fa-trash-can"></i></button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function openAddTeamModal(defaultProjectId = null) {
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const selectedProjId = defaultProjectId || (state.activeProjectId !== 'all' ? state.activeProjectId : (projects[0] ? projects[0].id : ''));

  const modalHtml = `
    <div class="modal-backdrop">
      <div class="modal-box modal-sm">
        <div class="modal-header">
          <h3><i class="fa-solid fa-people-group"></i> เพิ่มชุดทีมงานใหม่</h3>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <form class="modal-body" onsubmit="saveTeamForm(event)">
          <div class="form-group">
            <label class="form-label">สังกัดโครงการ *</label>
            <select id="modal-team-proj" class="form-select" required>
              ${projects.map(p => `<option value="${p.id}" ${p.id === selectedProjId ? 'selected' : ''}>${p.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">ชื่อทีมงาน *</label>
            <input type="text" id="modal-team-name" class="form-input" required placeholder="เช่น ทีมช่างปูน 1" />
          </div>
          <div class="form-group">
            <label class="form-label">คำอธิบาย</label>
            <input type="text" id="modal-team-desc" class="form-input" placeholder="เช่น รับผิดชอบงานชั้น 1-3" />
          </div>
          <div class="form-group">
            <label class="form-label">สีประจำทีม</label>
            <input type="color" id="modal-team-color" class="form-input" style="height:40px;padding:2px;" value="#2563eb" />
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> บันทึกทีมงาน</button>
          </div>
        </form>
      </div>
    </div>
  `;
  openModal(modalHtml);
}

function openEditTeamModal(teamId) {
  const teams = getStorage(DB_KEYS.TEAMS) || [];
  const team = teams.find(t => t.id === teamId);
  if (!team) return;

  const projects = getStorage(DB_KEYS.PROJECTS) || [];

  const modalHtml = `
    <div class="modal-backdrop">
      <div class="modal-box modal-sm">
        <div class="modal-header">
          <h3><i class="fa-solid fa-pen"></i> แก้ไขทีมงาน</h3>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <form class="modal-body" onsubmit="saveTeamForm(event, '${teamId}')">
          <div class="form-group">
            <label class="form-label">สังกัดโครงการ *</label>
            <select id="modal-team-proj" class="form-select" required>
              ${projects.map(p => `<option value="${p.id}" ${p.id === team.projectId ? 'selected' : ''}>${p.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">ชื่อทีมงาน *</label>
            <input type="text" id="modal-team-name" class="form-input" required value="${team.name}" />
          </div>
          <div class="form-group">
            <label class="form-label">คำอธิบาย</label>
            <input type="text" id="modal-team-desc" class="form-input" value="${team.description || ''}" />
          </div>
          <div class="form-group">
            <label class="form-label">สีประจำทีม</label>
            <input type="color" id="modal-team-color" class="form-input" style="height:40px;padding:2px;" value="${team.color || '#2563eb'}" />
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> อัปเดต</button>
          </div>
        </form>
      </div>
    </div>
  `;
  openModal(modalHtml);
}

function saveTeamForm(event, editingId = null) {
  event.preventDefault();
  const teams = getStorage(DB_KEYS.TEAMS) || [];
  const projectId = document.getElementById('modal-team-proj').value;
  const name = document.getElementById('modal-team-name').value.trim();
  const desc = document.getElementById('modal-team-desc').value.trim();
  const color = document.getElementById('modal-team-color').value;

  if (editingId) {
    const idx = teams.findIndex(t => t.id === editingId);
    if (idx !== -1) {
      teams[idx] = { ...teams[idx], projectId, name, description: desc, color };
    }
  } else {
    teams.push({
      id: `team-${Date.now()}`,
      projectId,
      name,
      description: desc,
      color
    });
  }

  setStorage(DB_KEYS.TEAMS, teams);
  closeModal();
  renderCurrentPage();
  showToast(`${editingId ? 'แก้ไข' : 'เพิ่ม'}ทีมงาน "${name}" เรียบร้อยแล้ว`, 'success');
}

function deleteTeam(teamId) {
  const teams = getStorage(DB_KEYS.TEAMS) || [];
  if (teams.length <= 1) {
    alert('ต้องมีชุดทีมงานอย่างน้อย 1 ทีมในระบบ');
    return;
  }

  if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบทีมงานนี้?')) return;

  const filtered = teams.filter(t => t.id !== teamId);
  setStorage(DB_KEYS.TEAMS, filtered);
  renderCurrentPage();
  showToast('ลบทีมงานเรียบร้อยแล้ว', 'warning');
}

// ─── VIEW 3: DASHBOARD ────────────────────────────────────────────────────────

function renderDashboardView() {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  let activeEmps = employees.filter(e => e.isActive);
  if (state.activeProjectId !== 'all') {
    activeEmps = activeEmps.filter(e => e.projectId === state.activeProjectId);
  }

  const allAttendance = getStorage(DB_KEYS.ATTENDANCE) || {};

  let stats = { total: activeEmps.length, present: 0, late: 0, leave: 0, absent: 0, field: 0, unchecked: 0, totalOtHours: 0 };
  activeEmps.forEach(emp => {
    const key = `${emp.id}_${state.currentDate}`;
    const record = allAttendance[key];
    const s = record ? record.status : 'unchecked';
    if (stats[s] !== undefined) stats[s]++;
    else stats.unchecked++;

    if (record && parseFloat(record.otHours || 0) > 0) {
      stats.totalOtHours += parseFloat(record.otHours);
    }
  });

  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const currentProj = projects.find(p => p.id === state.activeProjectId);

  return `
    <div class="page-header">
      <div>
        <h2 class="page-title"><i class="fa-solid fa-chart-pie"></i> แดชบอร์ดสรุปผลรายวัน</h2>
        <p class="page-subtitle">${formatThaiFullDate(state.currentDate)} • <strong>${currentProj ? currentProj.name : 'ทุกโครงการ'}</strong></p>
      </div>
      <div>
        <input type="date" class="date-picker-input" value="${state.currentDate}" onchange="changeAttendanceDate(this.value)" />
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="kpi-card">
        <div class="kpi-icon-wrap" style="background:#eff6ff;color:var(--primary);"><i class="fa-solid fa-users"></i></div>
        <div>
          <div class="kpi-val">${stats.total}</div>
          <div class="kpi-title">คนงานทั้งหมด</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon-wrap" style="background:var(--color-present-bg);color:var(--color-present);"><i class="fa-solid fa-circle-check"></i></div>
        <div>
          <div class="kpi-val" style="color:var(--color-present);">${stats.present}</div>
          <div class="kpi-title">มาตรงเวลา</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon-wrap" style="background:var(--color-late-bg);color:var(--color-late);"><i class="fa-solid fa-clock"></i></div>
        <div>
          <div class="kpi-val" style="color:var(--color-late);">${stats.late}</div>
          <div class="kpi-title">มาสาย</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon-wrap" style="background:var(--color-leave-bg);color:var(--color-leave);"><i class="fa-solid fa-calendar-minus"></i></div>
        <div>
          <div class="kpi-val" style="color:var(--color-leave);">${stats.leave}</div>
          <div class="kpi-title">ลางาน</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon-wrap" style="background:var(--color-absent-bg);color:var(--color-absent);"><i class="fa-solid fa-circle-xmark"></i></div>
        <div>
          <div class="kpi-val" style="color:var(--color-absent);">${stats.absent}</div>
          <div class="kpi-title">ขาดงาน</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon-wrap" style="background:var(--color-field-bg);color:var(--color-field);"><i class="fa-solid fa-location-dot"></i></div>
        <div>
          <div class="kpi-val" style="color:var(--color-field);">${stats.field}</div>
          <div class="kpi-title">นอกไซต์</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon-wrap" style="background:#f1f5f9;color:var(--text-muted);"><i class="fa-solid fa-circle-dot"></i></div>
        <div>
          <div class="kpi-val" style="color:var(--text-muted);">${stats.unchecked}</div>
          <div class="kpi-title">ยังไม่เช็ค</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon-wrap" style="background:#fffbeb;color:#b45309;"><i class="fa-solid fa-bolt"></i></div>
        <div>
          <div class="kpi-val" style="color:#b45309;">${stats.totalOtHours.toFixed(1)} <span style="font-size:0.85rem;">ชม.</span></div>
          <div class="kpi-title">รวม OT วันนี้</div>
        </div>
      </div>
    </div>

    <div style="background:#fff;border-radius:var(--radius-lg);padding:1.15rem;border:1px solid var(--border-color);margin-bottom:1.25rem;">
      <h3 style="font-size:0.95rem;font-weight:700;margin-bottom:0.75rem;"><i class="fa-solid fa-chart-simple"></i> สัดส่วนการมาทำงานวันนี้</h3>
      <div style="max-width:360px;margin:0 auto;height:240px;">
        <canvas id="attendanceDonutChart"></canvas>
      </div>
    </div>
  `;
}

function initDashboardCharts() {
  const canvas = document.getElementById('attendanceDonutChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  let activeEmps = employees.filter(e => e.isActive);
  if (state.activeProjectId !== 'all') {
    activeEmps = activeEmps.filter(e => e.projectId === state.activeProjectId);
  }

  const allAttendance = getStorage(DB_KEYS.ATTENDANCE) || {};

  let present = 0, late = 0, leave = 0, absent = 0, field = 0, unchecked = 0;
  activeEmps.forEach(emp => {
    const key = `${emp.id}_${state.currentDate}`;
    const record = allAttendance[key];
    const s = record ? record.status : 'unchecked';
    if (s === 'present') present++;
    else if (s === 'late') late++;
    else if (s === 'leave') leave++;
    else if (s === 'absent') absent++;
    else if (s === 'field') field++;
    else unchecked++;
  });

  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['มาทำงาน', 'มาสาย', 'ลางาน', 'ขาดงาน', 'นอกสถานที่', 'ยังไม่เช็ค'],
      datasets: [{
        data: [present, late, leave, absent, field, unchecked],
        backgroundColor: ['#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#0284c7', '#cbd5e1']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });
}

// ─── VIEW 4: EMPLOYEES MANAGEMENT ────────────────────────────────────────────

function renderEmployeesView() {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const teams = getStorage(DB_KEYS.TEAMS) || [];
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const teamMap = {};
  teams.forEach(t => teamMap[t.id] = t);
  const projMap = {};
  projects.forEach(p => projMap[p.id] = p);

  let displayEmps = employees;
  if (state.activeProjectId !== 'all') {
    displayEmps = displayEmps.filter(e => e.projectId === state.activeProjectId);
  }

  return `
    <div class="page-header">
      <div>
        <h2 class="page-title"><i class="fa-solid fa-users"></i> จัดการรายชื่อคนงาน</h2>
        <p class="page-subtitle">แสดงคนงาน ${displayEmps.length} คน (สามารถถ่ายรูปและจัดกลุ่มตามโครงการ/ทีมได้)</p>
      </div>
      <div>
        <button class="btn btn-primary" onclick="openAddEmployeeModal()">
          <i class="fa-solid fa-user-plus"></i> เพิ่มคนงานใหม่
        </button>
      </div>
    </div>

    <div class="att-cards-grid">
      ${displayEmps.map(emp => {
        const team = teamMap[emp.teamId];
        const proj = projMap[emp.projectId];
        const avatarUrl = getEmployeeAvatar(emp, 56);

        return `
          <div class="att-card" style="border-left: 4px solid ${emp.isActive ? 'var(--primary)' : 'var(--text-light)'};">
            <div class="att-card-top">
              <div class="att-emp-avatar-wrap" onclick="openPhotoModal('${emp.id}')" title="คลิกเพื่อเปลี่ยนรูปถ่ายคนงาน">
                <img src="${avatarUrl}" alt="${emp.firstName}" class="att-emp-avatar" onerror="this.src='${getInitialsAvatar(emp.firstName, 56)}'" />
                <div style="position:absolute;bottom:0;right:0;background:rgba(0,0,0,0.6);color:#fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:0.6rem;">
                  <i class="fa-solid fa-camera"></i>
                </div>
              </div>
              <div class="att-emp-info" onclick="navigateTo('history', { empId: '${emp.id}' })">
                <div class="att-emp-name-row">
                  <span class="att-emp-name">${emp.firstName} ${emp.lastName}</span>
                  ${emp.nickname ? `<span class="att-emp-nick">(${emp.nickname})</span>` : ''}
                </div>
                <div class="att-emp-meta">
                  <span>${emp.id}</span>
                  ${proj ? `<span>• 🏢 ${proj.name}</span>` : ''}
                  ${team ? `<span>• <strong style="color:${team.color};">${team.name}</strong></span>` : ''}
                </div>
                <div class="att-emp-pos"><i class="fa-solid fa-phone"></i> ${emp.phone || '-'} | ${LABOR_TYPES[emp.laborType] || 'คนงาน'}</div>
              </div>
              <div>
                <span class="status-badge" style="background:${emp.isActive ? '#ecfdf5' : '#f1f5f9'};color:${emp.isActive ? '#10b981' : '#94a3b8'};">
                  ${emp.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:0.35rem;border-top:1px solid var(--border-light);padding-top:0.45rem;margin-top:0.15rem;flex-wrap:wrap;">
              <button class="btn btn-outline btn-sm" onclick="openPhotoModal('${emp.id}')" style="color:#d97706;">
                <i class="fa-solid fa-camera"></i> รูป
              </button>
              <button class="btn btn-outline btn-sm" onclick="openEditEmployeeModal('${emp.id}')">
                <i class="fa-regular fa-pen-to-square"></i> แก้ไข
              </button>
              <button class="btn btn-outline btn-sm" onclick="toggleEmployeeActive('${emp.id}')">
                ${emp.isActive ? '<i class="fa-solid fa-eye-slash"></i> ปิด' : '<i class="fa-solid fa-eye"></i> เปิด'}
              </button>
              <button class="btn btn-outline btn-sm" style="color:var(--color-absent);" onclick="deleteEmployee('${emp.id}')">
                <i class="fa-regular fa-trash-can"></i>
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function openAddEmployeeModal() {
  state.photoModalTempAvatar = '';
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const teams = getStorage(DB_KEYS.TEAMS) || [];
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const nextId = `EMP-${String(employees.length + 1).padStart(3, '0')}`;

  const defaultProj = state.activeProjectId !== 'all' ? state.activeProjectId : (projects[0] ? projects[0].id : '');

  const modalHtml = `
    <div class="modal-backdrop">
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3><i class="fa-solid fa-user-plus"></i> เพิ่มข้อมูลคนงานใหม่</h3>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <form class="modal-body" onsubmit="saveEmployeeForm(event)">
          <div style="display:flex;gap:0.75rem;align-items:center;padding:0.75rem;background:var(--bg-app);border-radius:var(--radius-md);border:1.5px dashed var(--border-color);">
            <img id="form-avatar-preview" src="${getInitialsAvatar('W', 64)}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;" />
            <div>
              <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                <label class="btn btn-primary btn-sm" style="cursor:pointer;">
                  <i class="fa-solid fa-camera"></i> ถ่ายภาพ
                  <input type="file" accept="image/*" capture="environment" style="display:none;" onchange="handleAvatarFileSelect(event)" />
                </label>
                <label class="btn btn-outline btn-sm" style="cursor:pointer;">
                  <i class="fa-solid fa-image"></i> เลือกไฟล์
                  <input type="file" accept="image/*" style="display:none;" onchange="handleAvatarFileSelect(event)" />
                </label>
              </div>
              <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;">ถ่ายภาพด้วยกล้องมือถือหรือเลือกรูปภาพ</div>
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">สังกัดโครงการ *</label>
              <select id="emp-project" class="form-select" required>
                ${projects.map(p => `<option value="${p.id}" ${p.id === defaultProj ? 'selected' : ''}>${p.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">สังกัดชุดทีมงาน</label>
              <select id="emp-team" class="form-select">
                <option value="">-- ไม่ระบุทีม --</option>
                ${teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">รหัสพนักงาน *</label>
              <input type="text" id="emp-id" class="form-input" required value="${nextId}" />
            </div>
            <div class="form-group">
              <label class="form-label">ชื่อเล่น</label>
              <input type="text" id="emp-nickname" class="form-input" placeholder="เช่น ชาย, กิต, เอก" />
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">ชื่อจริง *</label>
              <input type="text" id="emp-firstname" class="form-input" required placeholder="ชื่อ" />
            </div>
            <div class="form-group">
              <label class="form-label">นามสกุล *</label>
              <input type="text" id="emp-lastname" class="form-input" required placeholder="นามสกุล" />
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">เบอร์โทรศัพท์</label>
              <input type="tel" id="emp-phone" class="form-input" placeholder="08x-xxx-xxxx" />
            </div>
            <div class="form-group">
              <label class="form-label">ตำแหน่ง</label>
              <input type="text" id="emp-position" class="form-input" placeholder="เช่น ช่างปูน, ช่างเชื่อม, คนงาน" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">ประเภทแรงงาน</label>
            <select id="emp-labortype" class="form-select">
              <option value="technician">ช่างฝีมือ</option>
              <option value="worker">คนงานทั่วไป</option>
              <option value="daily">พนักงานรายวัน</option>
              <option value="contractor">ผู้รับเหมาช่วง</option>
              <option value="employee">พนักงานประจำ</option>
              <option value="other">อื่น ๆ</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">หมายเหตุ</label>
            <textarea id="emp-note" class="form-input" rows="2" placeholder="เช่น ทักษะเฉพาะทาง"></textarea>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> บันทึกคนงาน</button>
          </div>
        </form>
      </div>
    </div>
  `;
  openModal(modalHtml);
}

function openEditEmployeeModal(empId) {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  state.photoModalTempAvatar = emp.avatar || '';
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const teams = getStorage(DB_KEYS.TEAMS) || [];

  const modalHtml = `
    <div class="modal-backdrop">
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3><i class="fa-solid fa-user-pen"></i> แก้ไขข้อมูล: ${emp.firstName} ${emp.lastName}</h3>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <form class="modal-body" onsubmit="saveEmployeeForm(event, '${empId}')">
          <div style="display:flex;gap:0.75rem;align-items:center;padding:0.75rem;background:var(--bg-app);border-radius:var(--radius-md);border:1.5px dashed var(--border-color);">
            <img id="form-avatar-preview" src="${getEmployeeAvatar(emp, 64)}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;" />
            <div>
              <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                <label class="btn btn-primary btn-sm" style="cursor:pointer;">
                  <i class="fa-solid fa-camera"></i> ถ่ายใหม่
                  <input type="file" accept="image/*" capture="environment" style="display:none;" onchange="handleAvatarFileSelect(event)" />
                </label>
                <label class="btn btn-outline btn-sm" style="cursor:pointer;">
                  <i class="fa-solid fa-image"></i> เลือกรูป
                  <input type="file" accept="image/*" style="display:none;" onchange="handleAvatarFileSelect(event)" />
                </label>
              </div>
              <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;">รูปภาพจะถูกบันทึกในฐานข้อมูล</div>
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">สังกัดโครงการ *</label>
              <select id="emp-project" class="form-select" required>
                ${projects.map(p => `<option value="${p.id}" ${p.id === emp.projectId ? 'selected' : ''}>${p.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">สังกัดชุดทีมงาน</label>
              <select id="emp-team" class="form-select">
                <option value="">-- ไม่ระบุทีม --</option>
                ${teams.map(t => `<option value="${t.id}" ${t.id === emp.teamId ? 'selected' : ''}>${t.name}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">รหัสพนักงาน *</label>
              <input type="text" id="emp-id" class="form-input" required value="${emp.id}" disabled />
            </div>
            <div class="form-group">
              <label class="form-label">ชื่อเล่น</label>
              <input type="text" id="emp-nickname" class="form-input" value="${emp.nickname || ''}" />
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">ชื่อจริง *</label>
              <input type="text" id="emp-firstname" class="form-input" required value="${emp.firstName}" />
            </div>
            <div class="form-group">
              <label class="form-label">นามสกุล *</label>
              <input type="text" id="emp-lastname" class="form-input" required value="${emp.lastName}" />
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">เบอร์โทรศัพท์</label>
              <input type="tel" id="emp-phone" class="form-input" value="${emp.phone || ''}" />
            </div>
            <div class="form-group">
              <label class="form-label">ตำแหน่ง</label>
              <input type="text" id="emp-position" class="form-input" value="${emp.position || ''}" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">ประเภทแรงงาน</label>
            <select id="emp-labortype" class="form-select">
              <option value="technician" ${emp.laborType === 'technician' ? 'selected' : ''}>ช่างฝีมือ</option>
              <option value="worker" ${emp.laborType === 'worker' ? 'selected' : ''}>คนงานทั่วไป</option>
              <option value="daily" ${emp.laborType === 'daily' ? 'selected' : ''}>พนักงานรายวัน</option>
              <option value="contractor" ${emp.laborType === 'contractor' ? 'selected' : ''}>ผู้รับเหมาช่วง</option>
              <option value="employee" ${emp.laborType === 'employee' ? 'selected' : ''}>พนักงานประจำ</option>
              <option value="other" ${emp.laborType === 'other' ? 'selected' : ''}>อื่น ๆ</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">หมายเหตุ</label>
            <textarea id="emp-note" class="form-input" rows="2">${emp.note || ''}</textarea>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> อัปเดตข้อมูล</button>
          </div>
        </form>
      </div>
    </div>
  `;
  openModal(modalHtml);
}

function handleAvatarFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > 3 * 1024 * 1024) {
    alert('กรุณาเลือกไฟล์ภาพขนาดไม่เกิน 3MB');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    state.photoModalTempAvatar = e.target.result;
    const preview = document.getElementById('form-avatar-preview');
    if (preview) preview.src = state.photoModalTempAvatar;
  };
  reader.readAsDataURL(file);
}

function saveEmployeeForm(event, editingId = null) {
  event.preventDefault();
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];

  const empData = {
    id: editingId || document.getElementById('emp-id').value.trim(),
    projectId: document.getElementById('emp-project').value,
    teamId: document.getElementById('emp-team').value,
    firstName: document.getElementById('emp-firstname').value.trim(),
    lastName: document.getElementById('emp-lastname').value.trim(),
    nickname: document.getElementById('emp-nickname').value.trim(),
    phone: document.getElementById('emp-phone').value.trim(),
    position: document.getElementById('emp-position').value.trim(),
    laborType: document.getElementById('emp-labortype').value,
    note: document.getElementById('emp-note').value.trim(),
    avatar: state.photoModalTempAvatar,
    isActive: true
  };

  if (editingId) {
    const idx = employees.findIndex(e => e.id === editingId);
    if (idx !== -1) {
      employees[idx] = { ...employees[idx], ...empData };
    }
  } else {
    if (employees.some(e => e.id === empData.id)) {
      alert('รหัสพนักงานนี้มีอยู่ในระบบแล้ว');
      return;
    }
    employees.push(empData);
  }

  setStorage(DB_KEYS.EMPLOYEES, employees);
  closeModal();
  renderCurrentPage();
  showToast(`${editingId ? 'แก้ไข' : 'เพิ่ม'}ข้อมูลคนงาน "${empData.firstName} ${empData.lastName}" สำเร็จ`, 'success');
}

function toggleEmployeeActive(empId) {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  emp.isActive = !emp.isActive;
  setStorage(DB_KEYS.EMPLOYEES, employees);
  renderCurrentPage();
  showToast(`${emp.isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}คนงาน ${emp.firstName} เรียบร้อยแล้ว`, 'info');
}

function deleteEmployee(empId) {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบคนงาน "${emp.firstName} ${emp.lastName}"?`)) return;

  const filtered = employees.filter(e => e.id !== empId);
  setStorage(DB_KEYS.EMPLOYEES, filtered);
  renderCurrentPage();
  showToast(`ลบคนงาน ${emp.firstName} ออกจากระบบแล้ว`, 'warning');
}

// ─── VIEW 5: EMPLOYEE PROFILE & HISTORY ───────────────────────────────────────

function renderHistoryView() {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const empId = state.selectedEmployeeId || (employees[0] ? employees[0].id : null);
  const emp = employees.find(e => e.id === empId);

  if (!emp) {
    return `<div class="empty-state"><h3>ไม่พบข้อมูลคนงาน</h3></div>`;
  }

  const allAttendance = getStorage(DB_KEYS.ATTENDANCE) || {};
  const historyList = [];

  Object.values(allAttendance).forEach(rec => {
    if (rec.employeeId === empId) {
      historyList.push(rec);
    }
  });

  historyList.sort((a, b) => b.date.localeCompare(a.date));

  return `
    <div class="page-header">
      <div>
        <h2 class="page-title"><i class="fa-solid fa-clock-rotate-left"></i> ประวัติการทำงานรายบุคคล</h2>
        <p class="page-subtitle">ตรวจสอบสถิติและประวัติย้อนหลังของคนงาน</p>
      </div>
      <div>
        <select class="filter-select" onchange="state.selectedEmployeeId=this.value;renderCurrentPage();">
          ${employees.map(e => `<option value="${e.id}" ${e.id === empId ? 'selected' : ''}>${e.firstName} ${e.lastName} (${e.id})</option>`).join('')}
        </select>
      </div>
    </div>

    <div style="background:#fff;border-radius:var(--radius-lg);padding:1.15rem;border:1px solid var(--border-color);margin-bottom:1.15rem;display:flex;gap:1.15rem;align-items:center;flex-wrap:wrap;">
      <div style="position:relative;cursor:pointer;" onclick="openPhotoModal('${emp.id}')" title="คลิกเพื่อเปลี่ยนรูปถ่าย">
        <img src="${getEmployeeAvatar(emp, 76)}" style="width:76px;height:76px;border-radius:50%;object-fit:cover;border:3px solid var(--primary-light);box-shadow:var(--shadow-sm);" />
        <div style="position:absolute;bottom:0;right:0;background:var(--primary);color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:0.7rem;border:2px solid #fff;">
          <i class="fa-solid fa-camera"></i>
        </div>
      </div>
      <div style="flex:1;min-width:180px;">
        <h3 style="font-size:1.15rem;font-weight:800;color:var(--text-main);">${emp.firstName} ${emp.lastName} ${emp.nickname ? `(${emp.nickname})` : ''}</h3>
        <div style="font-size:0.82rem;color:var(--text-muted);margin-top:0.15rem;">
          <span>รหัส: <strong>${emp.id}</strong></span> • 
          <span>ตำแหน่ง: <strong>${emp.position || '-'}</strong></span> • 
          <span>โทร: <strong>${emp.phone || '-'}</strong></span>
        </div>
        <div style="margin-top:0.35rem;">
          <button class="btn btn-outline btn-sm" onclick="openPhotoModal('${emp.id}')">
            <i class="fa-solid fa-camera"></i> เปลี่ยนรูปคนงาน
          </button>
        </div>
      </div>
    </div>

    <div style="background:#fff;border-radius:var(--radius-lg);border:1px solid var(--border-color);overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <table style="width:100%;border-collapse:collapse;font-size:0.84rem;min-width:580px;">
        <thead>
          <tr style="background:var(--bg-app);border-bottom:1px solid var(--border-color);text-align:left;">
            <th style="padding:0.65rem 0.85rem;">วันที่</th>
            <th style="padding:0.65rem 0.85rem;">สถานะ</th>
            <th style="padding:0.65rem 0.85rem;">เวลาเข้า-ออก</th>
            <th style="padding:0.65rem 0.85rem;">OT (ชม.)</th>
            <th style="padding:0.65rem 0.85rem;">หมายเหตุ / สถานที่</th>
          </tr>
        </thead>
        <tbody>
          ${historyList.length === 0 ? `
            <tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted);">ยังไม่มีประวัติการเช็คชื่อสำหรับคนงานท่านนี้</td></tr>
          ` : historyList.map(rec => {
            const stCfg = STATUS_CONFIG[rec.status] || STATUS_CONFIG.unchecked;
            return `
              <tr style="border-bottom:1px solid var(--border-light);">
                <td style="padding:0.65rem 0.85rem;font-weight:600;">${formatThaiDate(rec.date)}</td>
                <td style="padding:0.65rem 0.85rem;">
                  <span class="status-badge status-${rec.status}">
                    <i class="fa-solid ${stCfg.icon}"></i> ${stCfg.label}
                  </span>
                </td>
                <td style="padding:0.65rem 0.85rem;">${rec.checkIn ? `${rec.checkIn} - ${rec.checkOut || '17:30'}` : '-'}</td>
                <td style="padding:0.65rem 0.85rem;font-weight:700;color:var(--color-late);">${parseFloat(rec.otHours || 0) > 0 ? `${rec.otHours} ชม.` : '-'}</td>
                <td style="padding:0.65rem 0.85rem;color:var(--text-muted);">${rec.note || rec.location || '-'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ─── VIEW 6: REPORTS & EXPORT (EXCEL A4, CSV UTF-8, PDF PRINT) ───────────────

function renderReportsView() {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const activeProj = projects.find(p => p.id === state.activeProjectId);

  let activeEmps = employees.filter(e => e.isActive);
  if (state.activeProjectId !== 'all') {
    activeEmps = activeEmps.filter(e => e.projectId === state.activeProjectId);
  }

  const allAttendance = getStorage(DB_KEYS.ATTENDANCE) || {};

  return `
    <div class="page-header">
      <div>
        <h2 class="page-title"><i class="fa-solid fa-file-export" style="color:var(--primary);"></i> รายงานสรุป & ส่งออกข้อมูล</h2>
        <p class="page-subtitle">โครงการ: <strong>${activeProj ? activeProj.name : 'ทุกโครงการ'}</strong> | วันที่: ${formatThaiDate(state.currentDate)}</p>
      </div>
      <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
        <button class="btn btn-danger btn-sm" onclick="exportToPdf()">
          <i class="fa-solid fa-file-pdf"></i> พิมพ์ / PDF (A4)
        </button>
        <button class="btn btn-success btn-sm" onclick="exportToExcel()">
          <i class="fa-solid fa-file-excel"></i> Excel (จัดหน้า A4)
        </button>
        <button class="btn btn-outline btn-sm" onclick="exportToCsv()">
          <i class="fa-solid fa-file-csv"></i> CSV (UTF-8)
        </button>
      </div>
    </div>

    <div style="background:#fff;border-radius:var(--radius-lg);border:1px solid var(--border-color);padding:0.85rem;overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.65rem;flex-wrap:wrap;gap:0.4rem;">
        <h3 style="font-size:0.92rem;font-weight:700;">
          <i class="fa-solid fa-table"></i> ตารางสรุปยอด (${activeEmps.length} คน)
        </h3>
        <input type="date" class="date-picker-input" value="${state.currentDate}" onchange="changeAttendanceDate(this.value)" />
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:0.8rem;min-width:620px;">
        <thead>
          <tr style="background:var(--bg-app);border-bottom:1.5px solid var(--border-color);text-align:left;">
            <th style="padding:0.5rem;">#</th>
            <th style="padding:0.5rem;">รหัส</th>
            <th style="padding:0.5rem;">ชื่อ-นามสกุล</th>
            <th style="padding:0.5rem;">ตำแหน่ง</th>
            <th style="padding:0.5rem;">สถานะ</th>
            <th style="padding:0.5rem;">เข้า-ออก</th>
            <th style="padding:0.5rem;">OT</th>
            <th style="padding:0.5rem;">หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          ${activeEmps.map((emp, i) => {
            const key = `${emp.id}_${state.currentDate}`;
            const rec = allAttendance[key];
            const st = rec ? rec.status : 'unchecked';
            const stCfg = STATUS_CONFIG[st] || STATUS_CONFIG.unchecked;

            return `
              <tr style="border-bottom:1px solid var(--border-light);">
                <td style="padding:0.45rem;color:var(--text-muted);">${i + 1}</td>
                <td style="padding:0.45rem;font-weight:600;">${emp.id}</td>
                <td style="padding:0.45rem;font-weight:700;">${emp.firstName} ${emp.lastName}</td>
                <td style="padding:0.45rem;">${emp.position || '-'}</td>
                <td style="padding:0.45rem;">
                  <span class="status-badge status-${st}">${stCfg.label}</span>
                </td>
                <td style="padding:0.45rem;">${rec && rec.checkIn ? `${rec.checkIn}-${rec.checkOut || '17:30'}` : '-'}</td>
                <td style="padding:0.45rem;font-weight:700;color:var(--color-late);">${rec && parseFloat(rec.otHours || 0) > 0 ? `${rec.otHours} ชม.` : '-'}</td>
                <td style="padding:0.45rem;color:var(--text-muted);">${(rec && (rec.note || rec.location)) || '-'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ─── 100% Vector Thai PDF & Print Engine (A4 Standard) ────────────────────────

function generatePrintHtml() {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const activeProj = projects.find(p => p.id === state.activeProjectId);

  let activeEmps = employees.filter(e => e.isActive);
  if (state.activeProjectId !== 'all') {
    activeEmps = activeEmps.filter(e => e.projectId === state.activeProjectId);
  }

  const allAttendance = getStorage(DB_KEYS.ATTENDANCE) || {};

  let presentCount = 0, lateCount = 0, leaveCount = 0, absentCount = 0, fieldCount = 0, totalOt = 0;
  activeEmps.forEach(emp => {
    const key = `${emp.id}_${state.currentDate}`;
    const rec = allAttendance[key];
    const s = rec ? rec.status : 'unchecked';
    if (s === 'present') presentCount++;
    else if (s === 'late') lateCount++;
    else if (s === 'leave') leaveCount++;
    else if (s === 'absent') absentCount++;
    else if (s === 'field') fieldCount++;

    if (rec && parseFloat(rec.otHours || 0) > 0) totalOt += parseFloat(rec.otHours);
  });

  return `
    <div class="print-header">
      <h1>ใบรายงานการปฏิบัติงาน & เช็คชื่อคนงานประจำวัน</h1>
      <h2>${activeProj ? activeProj.name : 'สรุปภาพรวมทุกโครงการ'}</h2>
      <div style="font-size:10pt;color:#333;">${activeProj ? activeProj.companyName : 'ระบบจัดการไซต์งาน'}</div>
    </div>

    <div class="print-meta-grid">
      <div><strong>วันที่ปฏิบัติงาน:</strong> ${formatThaiFullDate(state.currentDate)}</div>
      <div><strong>ผู้ควบคุมงาน:</strong> ${activeProj ? activeProj.supervisorName : 'วิศวกรผู้ควบคุม'}</div>
      <div><strong>พิมพ์เมื่อ:</strong> ${new Date().toLocaleDateString('th-TH')} ${new Date().toLocaleTimeString('th-TH')}</div>
    </div>

    <div class="print-stats-summary">
      <div>คนงานทั้งหมด: <strong>${activeEmps.length}</strong> คน</div>
      <div>มาทำงาน: <strong>${presentCount}</strong></div>
      <div>มาสาย: <strong>${lateCount}</strong></div>
      <div>ลางาน: <strong>${leaveCount}</strong></div>
      <div>ขาดงาน: <strong>${absentCount}</strong></div>
      <div>นอกไซต์: <strong>${fieldCount}</strong></div>
      <div>รวม OT: <strong>${totalOt.toFixed(1)}</strong> ชม.</div>
    </div>

    <table class="print-table">
      <thead>
        <tr>
          <th style="width:28px;">#</th>
          <th style="width:60px;">รหัส</th>
          <th>ชื่อ - สกุล</th>
          <th>ตำแหน่ง / หน้าที่</th>
          <th style="width:70px;">สถานะ</th>
          <th style="width:80px;">เวลาเข้า-ออก</th>
          <th style="width:50px;">OT (ชม.)</th>
          <th>หมายเหตุ / สถานที่</th>
        </tr>
      </thead>
      <tbody>
        ${activeEmps.map((emp, idx) => {
          const key = `${emp.id}_${state.currentDate}`;
          const rec = allAttendance[key];
          const st = rec ? rec.status : 'unchecked';
          const stLabel = STATUS_CONFIG[st] ? STATUS_CONFIG[st].label : 'ยังไม่เช็ค';

          return `
            <tr>
              <td style="text-align:center;">${idx + 1}</td>
              <td style="text-align:center;font-weight:600;">${emp.id}</td>
              <td style="font-weight:600;">${emp.firstName} ${emp.lastName} ${emp.nickname ? `(${emp.nickname})` : ''}</td>
              <td>${emp.position || '-'}</td>
              <td style="text-align:center;font-weight:bold;">${stLabel}</td>
              <td style="text-align:center;">${rec && rec.checkIn ? `${rec.checkIn} - ${rec.checkOut || '17:30'}` : '-'}</td>
              <td style="text-align:center;font-weight:bold;">${rec && parseFloat(rec.otHours || 0) > 0 ? rec.otHours : '-'}</td>
              <td>${(rec && (rec.note || rec.location)) || '-'}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>

    <div class="print-signatures">
      <div class="print-sig-box">
        <div>ผู้รายงาน / เช็คชื่อ</div>
        <div class="print-sig-line"></div>
        <div>(......................................................)</div>
        <div style="font-size:9pt;margin-top:4px;">เจ้าหน้าที่ความปลอดภัย / โฟร์แมน</div>
      </div>

      <div class="print-sig-box">
        <div>ผู้ตรวจสอบ / อนุมัติ</div>
        <div class="print-sig-line"></div>
        <div>(${activeProj ? activeProj.supervisorName : '......................................................'})</div>
        <div style="font-size:9pt;margin-top:4px;">วิศวกรผู้ควบคุมโครงการ / Site Manager</div>
      </div>
    </div>
  `;
}

function exportToPdf() {
  const printArea = document.getElementById('printable-report-area');
  if (printArea) {
    printArea.innerHTML = generatePrintHtml();
  }

  const modalHtml = `
    <div class="modal-backdrop">
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3><i class="fa-solid fa-file-pdf" style="color:#dc2626;"></i> พิมพ์รายงาน & บันทึก PDF (A4 ภาษาไทยคมชัด 100%)</h3>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body" style="background:#f1f5f9;">
          <div style="background:#fff;padding:1.25rem;border-radius:var(--radius-md);box-shadow:var(--shadow-sm);border:1px solid var(--border-color);">
            ${generatePrintHtml()}
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">ปิด</button>
          <button type="button" class="btn btn-danger" onclick="triggerBrowserPrint()"><i class="fa-solid fa-print"></i> สั่งพิมพ์ / บันทึก PDF ตอนนี้</button>
        </div>
      </div>
    </div>
  `;
  openModal(modalHtml);
}

function triggerBrowserPrint() {
  const printArea = document.getElementById('printable-report-area');
  if (printArea) {
    printArea.innerHTML = generatePrintHtml();
  }
  window.print();
}

// ─── EXCEL (A4 Page-Fitted Layout) ────────────────────────────────────────────

function exportToExcel() {
  if (typeof XLSX === 'undefined') {
    alert('กำลังโหลดโมดูล Excel กรุณาลองใหม่อีกครั้ง');
    return;
  }

  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const activeProj = projects.find(p => p.id === state.activeProjectId);

  let activeEmps = employees.filter(e => e.isActive);
  if (state.activeProjectId !== 'all') {
    activeEmps = activeEmps.filter(e => e.projectId === state.activeProjectId);
  }

  const allAttendance = getStorage(DB_KEYS.ATTENDANCE) || {};

  const rows = [
    ['ใบรายงานการปฏิบัติงาน & เช็คชื่อคนงานประจำวัน'],
    [`โครงการ: ${activeProj ? activeProj.name : 'ทุกโครงการ'} | บริษัท: ${activeProj ? activeProj.companyName : '-'}`],
    [`วันที่: ${state.currentDate} | ผู้ควบคุมงาน: ${activeProj ? activeProj.supervisorName : '-'}`],
    [],
    ['ลำดับ', 'รหัสพนักงาน', 'ชื่อ-นามสกุล', 'ชื่อเล่น', 'ตำแหน่ง', 'สถานะ', 'เวลาเข้า', 'เวลาออก', 'OT (ชม.)', 'หมายเหตุ / สถานที่']
  ];

  activeEmps.forEach((emp, i) => {
    const key = `${emp.id}_${state.currentDate}`;
    const rec = allAttendance[key];
    const st = rec ? rec.status : 'unchecked';
    rows.push([
      i + 1,
      emp.id,
      `${emp.firstName} ${emp.lastName}`,
      emp.nickname || '',
      emp.position || '',
      STATUS_CONFIG[st].label,
      (rec && rec.checkIn) || '',
      (rec && rec.checkOut) || '',
      (rec && rec.otHours) || '0',
      (rec && (rec.note || rec.location)) || ''
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Auto-fit column widths optimized for A4 Printing
  ws['!cols'] = [
    { wch: 6 },  // ลำดับ
    { wch: 12 }, // รหัส
    { wch: 22 }, // ชื่อ-นามสกุล
    { wch: 10 }, // ชื่อเล่น
    { wch: 18 }, // ตำแหน่ง
    { wch: 12 }, // สถานะ
    { wch: 10 }, // เวลาเข้า
    { wch: 10 }, // เวลาออก
    { wch: 10 }, // OT
    { wch: 25 }  // หมายเหตุ
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance_A4');

  const cleanProject = (activeProj ? activeProj.name : 'all_projects').replace(/[^a-zA-Z0-9ก-๙_-]/g, '_');
  XLSX.writeFile(wb, `รายงานเช็คชื่อ_${cleanProject}_${state.currentDate}.xlsx`);
  showToast('ส่งออก Excel (จัดหน้า A4) สำเร็จแล้ว', 'success');
}

// ─── CSV Export (UTF-8 BOM for Excel compatibility) ───────────────────────────

function exportToCsv() {
  const employees = getStorage(DB_KEYS.EMPLOYEES) || [];
  const projects = getStorage(DB_KEYS.PROJECTS) || [];
  const activeProj = projects.find(p => p.id === state.activeProjectId);

  let activeEmps = employees.filter(e => e.isActive);
  if (state.activeProjectId !== 'all') {
    activeEmps = activeEmps.filter(e => e.projectId === state.activeProjectId);
  }

  const allAttendance = getStorage(DB_KEYS.ATTENDANCE) || {};

  const lines = [
    ['ลำดับ', 'รหัส', 'ชื่อ-นามสกุล', 'ชื่อเล่น', 'ตำแหน่ง', 'สถานะ', 'เวลาเข้า', 'เวลาออก', 'OT_ชม', 'หมายเหตุ']
  ];

  activeEmps.forEach((emp, i) => {
    const key = `${emp.id}_${state.currentDate}`;
    const rec = allAttendance[key];
    const st = rec ? rec.status : 'unchecked';
    lines.push([
      i + 1,
      emp.id,
      `"${emp.firstName} ${emp.lastName}"`,
      `"${emp.nickname || ''}"`,
      `"${emp.position || ''}"`,
      `"${STATUS_CONFIG[st].label}"`,
      (rec && rec.checkIn) || '',
      (rec && rec.checkOut) || '',
      (rec && rec.otHours) || '0',
      `"${(rec && (rec.note || rec.location)) || ''}"`
    ]);
  });

  const csvContent = '\uFEFF' + lines.map(e => e.join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const cleanProject = (activeProj ? activeProj.name : 'all').replace(/[^a-zA-Z0-9ก-๙_-]/g, '_');
  a.download = `attendance_${cleanProject}_${state.currentDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('ส่งออก CSV (UTF-8) สำเร็จแล้ว', 'success');
}

// ─── VIEW 7: BACKUP & RESTORE ────────────────────────────────────────────────

function renderBackupView() {
  return `
    <div class="page-header">
      <div>
        <h2 class="page-title"><i class="fa-solid fa-database"></i> ศูนย์สำรอง & กู้คืนข้อมูล</h2>
        <p class="page-subtitle">บันทึกฐานข้อมูลโครงการ ทีมงาน และประวัติลงเครื่อง</p>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:0.85rem;">
      <div style="background:#fff;border-radius:var(--radius-lg);padding:1.25rem;border:1px solid var(--border-color);">
        <h3 style="font-size:1rem;font-weight:700;color:var(--primary);margin-bottom:0.4rem;">
          <i class="fa-solid fa-cloud-arrow-down"></i> สำรองข้อมูล (Export JSON)
        </h3>
        <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.85rem;">
          ดาวน์โหลดไฟล์ JSON ทั้งโครงการ ทีมงาน คนงาน และเวลาทำงานเก็บไว้
        </p>
        <button class="btn btn-primary btn-full" onclick="downloadBackupJson()">
          <i class="fa-solid fa-download"></i> ดาวน์โหลด Backup JSON
        </button>
      </div>

      <div style="background:#fff;border-radius:var(--radius-lg);padding:1.25rem;border:1px solid var(--border-color);">
        <h3 style="font-size:1rem;font-weight:700;color:var(--color-late);margin-bottom:0.4rem;">
          <i class="fa-solid fa-cloud-arrow-up"></i> กู้คืนข้อมูล (Import JSON)
        </h3>
        <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.85rem;">
          เลือกไฟล์ JSON ที่เคยสำรองไว้เพื่อกู้คืนฐานข้อมูลกลับมา
        </p>
        <label class="btn btn-warning btn-full" style="cursor:pointer;">
          <i class="fa-solid fa-file-import"></i> นำเข้าไฟล์ JSON
          <input type="file" accept=".json" style="display:none;" onchange="importBackupJson(event)" />
        </label>
      </div>
    </div>
  `;
}

function downloadBackupJson() {
  const data = {};
  Object.values(DB_KEYS).forEach(k => {
    data[k] = getStorage(k);
  });

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup_attendance_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('ดาวน์โหลดไฟล์สำรองข้อมูลสำเร็จแล้ว', 'success');
}

function importBackupJson(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการกู้คืนข้อมูล? ข้อมูลปัจจุบันจะถูกเขียนทับ')) return;

      Object.keys(data).forEach(k => {
        if (data[k] !== null) {
          setStorage(k, data[k]);
        }
      });
      renderNavBars();
      renderCurrentPage();
      showToast('กู้คืนฐานข้อมูลเรียบร้อยแล้ว', 'success');
    } catch (err) {
      alert('ไฟล์ JSON ไม่ถูกต้องหรือไม่สมบูรณ์');
    }
  };
  reader.readAsText(file);
}

// ─── Main View Router ─────────────────────────────────────────────────────────

function renderCurrentPage() {
  const content = document.getElementById('content');
  if (!content) return;

  switch (state.currentView) {
    case 'attendance':
      content.innerHTML = renderAttendanceView();
      break;
    case 'projects_teams':
      content.innerHTML = renderProjectsTeamsView();
      break;
    case 'dashboard':
      content.innerHTML = renderDashboardView();
      initDashboardCharts();
      break;
    case 'employees':
      content.innerHTML = renderEmployeesView();
      break;
    case 'history':
      content.innerHTML = renderHistoryView();
      break;
    case 'reports':
      content.innerHTML = renderReportsView();
      break;
    case 'backup':
      content.innerHTML = renderBackupView();
      break;
    default:
      content.innerHTML = renderAttendanceView();
  }
}

// ─── Manual Save & Refresh (บันทึกขึ้นคลาวด์ / ดึงข้อมูลล่าสุด — ปุ่มอยู่ใน topbar ด้านบน
// ย้ายออกจากปุ่มลอย fixed เดิม เพราะไปบังปุ่มเช็คชื่อในรายการเวลาผู้ใช้เลื่อนหน้าจอ) ───

// บันทึกข้อมูลทั้งหมดในเครื่องขึ้นคลาวด์ทันที (ใช้หลังกรอกข้อมูลเสร็จ เพื่อความมั่นใจว่าบันทึกขึ้นคลาวด์แล้วจริง)
async function saveNow() {
  const btn = document.getElementById('manual-save-btn');
  if (!firebaseDb) {
    showDebugBanner('⚠️ ยังไม่ได้เชื่อมต่อ Firebase จึงบันทึกขึ้นคลาวด์ไม่ได้ (ข้อมูลยังอยู่ในเครื่องนี้เท่านั้น)', true);
    return;
  }
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span class="btn-text-desktop">กำลังบันทึก...</span>'; }
  try {
    const keys = Object.values(DB_KEYS);
    let count = 0;
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        await firebaseDb.collection('attendance_data').doc(key).set({
          data: JSON.parse(raw),
          updatedAt: Date.now()
        });
        count++;
      }
    }
    showDebugBanner('✅ บันทึกขึ้นคลาวด์สำเร็จ (' + count + ' รายการ) | เวลา: ' + new Date().toLocaleTimeString('th-TH'), false);
    showToast('บันทึกข้อมูลขึ้นคลาวด์เรียบร้อยแล้ว', 'success');
  } catch (err) {
    showDebugBanner('❌ บันทึกไม่สำเร็จ: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> <span class="btn-text-desktop">บันทึกข้อมูล</span>'; }
  }
}

// ดึงข้อมูลล่าสุดจาก Firestore มาแสดงทันที (ใช้ตอนสงสัยว่าเครื่องนี้ยังไม่เห็นข้อมูลใหม่)
async function refreshNow() {
  const btn = document.getElementById('manual-refresh-btn');
  if (!firebaseDb) {
    showDebugBanner('⚠️ ยังไม่ได้เชื่อมต่อ Firebase จึงรีเฟรชไม่ได้ (ใช้ข้อมูลในเครื่องเท่านั้น)', true);
    return;
  }
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span class="btn-text-desktop">กำลังรีเฟรช...</span>'; }
  try {
    const snapshot = await firebaseDb.collection('attendance_data').get({ source: 'server' });
    let count = 0;
    snapshot.forEach(doc => {
      const docData = doc.data();
      if (docData && docData.data !== undefined) {
        localStorage.setItem(doc.id, JSON.stringify(docData.data));
        count++;
      }
    });
    renderNavBars();
    renderCurrentPage();
    showDebugBanner('✅ รีเฟรชสำเร็จ ดึงข้อมูลล่าสุด ' + count + ' รายการ | เวลา: ' + new Date().toLocaleTimeString('th-TH'), false);
    showToast('อัปเดตข้อมูลล่าสุดเรียบร้อยแล้ว', 'success');
  } catch (err) {
    showDebugBanner('❌ รีเฟรชไม่สำเร็จ: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> <span class="btn-text-desktop">รีเฟรชข้อมูล</span>'; }
  }
}

// ─── Initialization on DOM Ready ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  seedInitialData();
  initFirebaseSync();
  renderNavBars();
  startLiveClock();
  renderCurrentPage();
});
