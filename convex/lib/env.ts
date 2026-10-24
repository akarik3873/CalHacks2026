export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name} (set with: npx convex env set ${name} ...)`);
  return value;
}
