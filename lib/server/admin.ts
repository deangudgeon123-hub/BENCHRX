import 'server-only';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { operatorAuthorized } from './access';
export async function requireAdmin() {
  if (!operatorAuthorized(await headers())) notFound();
}
