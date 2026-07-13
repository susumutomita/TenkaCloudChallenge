import { startBusService } from './bus.mjs';
import { startEcuService } from './ecu.mjs';
import { startOtaService } from './ota.mjs';
import { startSigningService } from './signing.mjs';
import { startTcuService } from './tcu.mjs';

const role = process.env.SERVICE_ROLE;

switch (role) {
  case 'signing':
    startSigningService();
    break;
  case 'bus':
    startBusService();
    break;
  case 'tcu':
    startTcuService();
    break;
  case 'ecu-a':
  case 'ecu-b':
    await startEcuService(role);
    break;
  case 'ota':
    startOtaService();
    break;
  default:
    throw new Error(`Unknown SERVICE_ROLE: ${role ?? '(missing)'}`);
}
