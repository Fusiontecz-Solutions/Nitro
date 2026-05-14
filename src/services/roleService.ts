import { ROLES } from '../constants/roles';

export async function getRoles() {
  // In this setup, roles are static and defined in constants.
  // If you later move roles into the database, update this
  // function to query Prisma instead.
  return ROLES;
}

