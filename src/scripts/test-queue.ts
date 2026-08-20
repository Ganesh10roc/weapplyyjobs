import axios from 'axios';
import { config } from '../config.js';

const API_URL = `http://${config.service.host}:${config.service.port}`;

interface HealthResponse {
  status: string;
  db: string;
  redis: string;
  queues: {
    notifications: { waiting: number; active: number; failed: number };
    'stats-updates': { waiting: number; active: number; failed: number };
    'audit-logs': { waiting: number; active: number; failed: number };
  };
  uptime: number;
}

async function fireApplicationRequests(count: number): Promise<void> {
  console.log(`Firing ${count} concurrent application submission requests...\n`);

  const requests = Array.from({ length: count }, (_, i) => {
    const requestData = {
      jobId: `job-${Math.floor(i / 5) + 1}`,
      candidateId: `candidate-${i + 1}`,
      recruiterId: `recruiter-${Math.floor(i / 10) + 1}`,
      coverLetter: `This is my cover letter for application ${i + 1}. I am very interested in this opportunity.`,
    };

    return axios.post(`${API_URL}/api/applications`, requestData).catch((error) => {
      console.error(`Request ${i + 1} failed:`, error.response?.data || error.message);
    });
  });

  const results = await Promise.all(requests);
  const successful = results.filter((r) => r && r.status === 201).length;

  console.log(`✓ ${successful}/${count} applications submitted successfully\n`);
}

async function pollQueueStats(intervalSeconds: number = 1, durationSeconds: number = 10): Promise<void> {
  console.log(`Polling queue stats every ${intervalSeconds}s for ${durationSeconds}s...\n`);
  console.log('Time    | Notifications (W/A/F) | Stats Updates (W/A/F) | Audit Logs (W/A/F)');
  console.log('--------|------------------------|----------------------|-------------------');

  const startTime = Date.now();
  const intervalMs = intervalSeconds * 1000;
  const durationMs = durationSeconds * 1000;

  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      try {
        const response = await axios.get<HealthResponse>(`${API_URL}/health`);
        const health = response.data;
        const elapsed = Math.floor((Date.now() - startTime) / 1000);

        const notif = health.queues.notifications;
        const stats = health.queues['stats-updates'];
        const audit = health.queues['audit-logs'];

        const timeStr = `${elapsed.toString().padStart(2, '0')}s`;
        const notifStr = `${notif.waiting}/${notif.active}/${notif.failed}`.padEnd(9);
        const statsStr = `${stats.waiting}/${stats.active}/${stats.failed}`.padEnd(9);
        const auditStr = `${audit.waiting}/${audit.active}/${audit.failed}`.padEnd(9);

        console.log(`${timeStr}    | ${notifStr}          | ${statsStr}          | ${auditStr}`);

        if (Date.now() - startTime >= durationMs) {
          clearInterval(interval);
          console.log('\n✓ Queue monitoring complete\n');
          resolve();
        }
      } catch (error) {
        console.error('Failed to fetch health stats:', (error as any).message);
      }
    }, intervalMs);
  });
}

async function main() {
  try {
    console.log('WeApplyJobs Queue Test Script');
    console.log('============================\n');

    // Wait for service to be ready
    console.log('Waiting for service to be ready...');
    let serviceReady = false;
    let attempts = 0;
    while (!serviceReady && attempts < 10) {
      try {
        await axios.get(`${API_URL}/health`);
        serviceReady = true;
      } catch {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (!serviceReady) {
      throw new Error('Service did not become ready in time');
    }

    console.log('✓ Service is ready\n');

    // Fire 20 concurrent requests
    await fireApplicationRequests(20);

    // Poll queue stats
    await pollQueueStats(1, 10);

    console.log('Test script completed successfully!');
  } catch (error) {
    console.error('Test script failed:', error);
    process.exit(1);
  }
}

main();
