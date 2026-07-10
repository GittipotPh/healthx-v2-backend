import type { SaveQueueConfigDto } from "./dto/save-queue-config.dto";

/**
 * Built-in queue configuration served when a branch has no `queue_config` row
 * yet. GET returns this without persisting anything; the row is only created
 * by an explicit save. Keep in sync with the seeded step catalog
 * (queue.constants.ts / prisma/sql/002_create_queue_status_and_config.sql).
 */
export const DEFAULT_QUEUE_CONFIG: SaveQueueConfigDto = {
  columns: [
    { id: "confirmed", label: "คอนเฟิร์มนัด", color: "#E0E7FF", enabled: true, order: 1, isRequired: false, canSkip: false, isEndStep: false },
    { id: "arrived", label: "มาถึงแล้ว", color: "#DBEAFE", enabled: true, order: 2, isRequired: false, canSkip: false, isEndStep: false },
    { id: "consulting", label: "กำลังปรึกษา", color: "#E9D5FF", enabled: true, order: 3, isRequired: false, canSkip: true, isEndStep: false },
    { id: "pending-payment", label: "รอชำระเงิน", color: "#FEF3C7", enabled: true, order: 4, isRequired: false, canSkip: false, isEndStep: false },
    { id: "anesthetic", label: "แปะยาชา", color: "#FFEDD5", enabled: true, order: 5, isRequired: false, canSkip: true, isEndStep: false },
    { id: "in-service", label: "กำลังบริการ", color: "#FCE7F3", enabled: true, order: 6, isRequired: false, canSkip: false, isEndStep: false },
    { id: "dispensing", label: "จ่ายยา", color: "#DBEAFE", enabled: true, order: 7, isRequired: false, canSkip: true, isEndStep: false },
    { id: "verified", label: "ตรวจแล้ว", color: "#D1FAE5", enabled: true, order: 8, isRequired: false, canSkip: false, isEndStep: false },
    { id: "completed", label: "กลับบ้านแล้ว", color: "#E5E7EB", enabled: true, order: 9, isRequired: false, canSkip: false, isEndStep: true },
  ],
  sla: [
    { columnId: "confirmed", warningMinutes: 0, criticalMinutes: 0, colorChange: false, notify: false },
    { columnId: "arrived", warningMinutes: 10, criticalMinutes: 15, colorChange: true, notify: true },
    { columnId: "consulting", warningMinutes: 20, criticalMinutes: 30, colorChange: true, notify: true },
    { columnId: "pending-payment", warningMinutes: 0, criticalMinutes: 0, colorChange: false, notify: false },
    { columnId: "anesthetic", warningMinutes: 30, criticalMinutes: 45, colorChange: true, notify: true },
    { columnId: "in-service", warningMinutes: 45, criticalMinutes: 60, colorChange: true, notify: true },
    { columnId: "dispensing", warningMinutes: 10, criticalMinutes: 20, colorChange: true, notify: false },
    { columnId: "verified", warningMinutes: 0, criticalMinutes: 0, colorChange: false, notify: false },
    { columnId: "completed", warningMinutes: 0, criticalMinutes: 0, colorChange: false, notify: false },
  ],
  transitions: {
    completed: {
      requiresPayment: true,
      requiresOPD: true,
      requiresCourse: true,
      requiresMedicine: true,
    },
    "in-service": {
      requiresPayment: false,
      requiresAnesthetic: false,
      requiresDoctor: false,
    },
  },
  automation: {
    defaultColumn: "arrived",
    autoOpenServicePopup: true,
    autoAssignDoctor: false,
    autoAssignRoom: false,
    anesthetic: {
      notifyStaff: true,
      changeStatusReady: true,
      autoMoveToInService: false,
    },
  },
  tracking: {
    trackTimeIn: true,
    trackTimeOut: true,
    autoCalculateDuration: true,
    trackActionBy: true,
    showTimeline: true,
    useForReports: true,
    allowManualOverride: false,
    requireReason: true,
    showActionOwnerOnCard: true,
    showRoleOnCard: true,
    showTimeOnCard: true,
    auditLog: true,
    preventEdit: true,
  },
  notifications: {
    late: { notifyStaff: true, notifyDoctor: false, notifyManager: false, notifyLine: false, sound: true, popup: false },
    arrived: { notifyStaff: true, notifyDoctor: false, notifyManager: false, notifyLine: false, sound: true, popup: false },
    turn: { notifyStaff: true, notifyDoctor: false, notifyManager: false, notifyLine: false, sound: true, popup: false },
    anesthetic: { notifyStaff: true, notifyDoctor: false, notifyManager: false, notifyLine: false, sound: true, popup: false },
    payment: { notifyStaff: true, notifyDoctor: false, notifyManager: false, notifyLine: false, sound: true, popup: false },
  },
  permissions: {
    confirmed: ["DOCTOR", "NURSE", "CASHIER", "ADMIN"],
    arrived: ["DOCTOR", "NURSE", "CASHIER", "ADMIN"],
    consulting: ["DOCTOR", "NURSE", "CASHIER", "ADMIN"],
    "pending-payment": ["DOCTOR", "NURSE", "CASHIER", "ADMIN"],
    anesthetic: ["DOCTOR", "NURSE", "CASHIER", "ADMIN"],
    "in-service": ["DOCTOR", "NURSE", "CASHIER", "ADMIN"],
    dispensing: ["DOCTOR", "NURSE", "CASHIER", "ADMIN"],
    verified: ["DOCTOR", "NURSE", "CASHIER", "ADMIN"],
    completed: ["DOCTOR", "NURSE", "CASHIER", "ADMIN"],
  },
};
