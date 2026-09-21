export function getRequiredEnv(name: string): string {
  const value = process.env[name]

  if (!value) throw new Error(`Missing ${name} env var`)

  return value
}
