/**
 * Host half of the Claude Desktop effort slider bundle.
 *
 * The whole control lives in the browser module: it reads the session model
 * directory the model-selection package already publishes and writes through
 * the same `select` that the shipped Effort row uses, so the Host needs no
 * additional service, projection, or config.
 */
export function apply() {}
