import mongoose from 'mongoose'

/**
 * Compiles a Mongoose model, recompiling it in development when its schema changes.
 *
 * `mongoose.models.X ?? mongoose.model('X', schema)` is the standard guard against
 * double-registration, but it caches the compiled model on the Mongoose singleton - and
 * that singleton outlives Next's dev HMR. Editing a schema therefore does nothing until the
 * dev server is restarted: the module re-evaluates, builds a fresh `Schema` object, and
 * then throws it away in favour of the model compiled at boot.
 *
 * What makes that worth a helper rather than a comment is how it fails. Mongoose is strict
 * by default, so an unknown path in `$set` is not an error - it is dropped. A field added
 * to a schema mid-session is silently absent from every write, the request returns 200, and
 * the only symptom is the value refusing to persist. That is exactly how `resume.hidePhoto`
 * came to be missing from the stored profile while every test covering it passed: tests
 * compile their models fresh, so the bug could only ever reproduce against a long-running
 * dev server.
 *
 * Production keeps the plain cached lookup. The process compiles once from code that cannot
 * change under it, so there is nothing to recompile and the delete/register churn would only
 * discard connection state for no benefit.
 */
export function compileModel<TSchema>(
  name: string,
  schema: mongoose.Schema<TSchema>
): mongoose.Model<TSchema> {
  if (process.env.NODE_ENV !== 'production' && mongoose.models[name]) {
    mongoose.deleteModel(name)
  }

  return (
    (mongoose.models[name] as mongoose.Model<TSchema> | undefined) ??
    mongoose.model<TSchema>(name, schema)
  )
}
