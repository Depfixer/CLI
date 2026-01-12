import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

/**
 * Device ID Service
 *
 * Generates and persists a unique device identifier in the user's home directory.
 * This ID is used to track anonymous CLI audits and link them to a user account
 * when they log in.
 *
 * Storage: ~/.depfixer/device.json (same location as credentials)
 * - Same device ID for ALL projects on this machine
 * - Persists across CLI sessions
 * - Enables conversion funnel tracking
 */

// Store in USER HOME directory (same location as credentials)
// ~/.depfixer/device.json on Unix, C:\Users\xxx\.depfixer\device.json on Windows
const CONFIG_DIR = path.join(os.homedir(), '.depfixer');
const DEVICE_FILE = path.join(CONFIG_DIR, 'device.json');

interface DeviceData {
  deviceId: string;
  createdAt: string;
}

/**
 * Get or generate the device ID.
 * Creates ~/.depfixer/device.json if it doesn't exist.
 *
 * @returns The persistent device ID for this machine
 */
export function getDeviceId(): string {
  // Ensure config dir exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Read existing device ID
  if (fs.existsSync(DEVICE_FILE)) {
    try {
      const data: DeviceData = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf-8'));
      if (data.deviceId) {
        return data.deviceId;
      }
    } catch {
      // File corrupted, regenerate
    }
  }

  // Generate new device ID
  const deviceId = `dev_${crypto.randomUUID()}`;
  const deviceData: DeviceData = {
    deviceId,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(DEVICE_FILE, JSON.stringify(deviceData, null, 2));

  return deviceId;
}

/**
 * Get device info including creation date.
 * Useful for debugging and admin display.
 *
 * @returns Device data or null if not found
 */
export function getDeviceInfo(): DeviceData | null {
  if (!fs.existsSync(DEVICE_FILE)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}
