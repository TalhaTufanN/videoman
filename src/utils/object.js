// Helper function to get value by key from nested objects
export function getValueByKey(obj, key) {
  if (typeof obj !== "object" || obj === null) return null;
  const stack = [obj];
  const visited = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    try {
      if (current[key] !== undefined) return current[key];
    } catch (error) {
      if (error.name === "SecurityError") continue;
      console.log(error);
    }
    for (const value of Object.values(current)) {
      if (typeof value === "object" && value !== null) {
        stack.push(value);
      }
    }
  }
  return null;
}
