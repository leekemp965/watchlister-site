import type { CollectionConfig } from 'payload'

/**
 * Single admin today, more editors later without a migration: roles are a
 * field, so granting someone access is an invite plus a dropdown.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'roles'],
  },
  access: {
    // Only admins manage accounts; everyone signed in can read their own.
    create: ({ req: { user } }) => hasRole(user, 'admin'),
    delete: ({ req: { user } }) => hasRole(user, 'admin'),
    update: ({ req: { user } }) => hasRole(user, 'admin'),
  },
  fields: [
    {
      name: 'name',
      type: 'text',
    },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      required: true,
      defaultValue: ['editor'],
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Editor', value: 'editor' },
      ],
      access: {
        // Editors must not be able to promote themselves.
        update: ({ req: { user } }) => hasRole(user, 'admin'),
      },
    },
  ],
}

export const hasRole = (user: unknown, role: string): boolean => {
  const roles = (user as { roles?: string[] } | null)?.roles
  return Array.isArray(roles) && roles.includes(role)
}

/** Published content is world-readable; editing requires a login. */
export const publicRead = () => true
export const signedIn = ({ req: { user } }: { req: { user: unknown } }) => Boolean(user)
