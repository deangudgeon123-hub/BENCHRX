import {createDiscoveryHandler} from '@/lib/server/connectors/discovery-handler';
export const runtime = 'nodejs';
export const maxDuration = 60;
export const POST = createDiscoveryHandler();
