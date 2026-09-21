import mongoose, { type Connection, type Mongoose } from 'mongoose'

import { getRequiredEnv } from '@/lib/required-env'

type MongooseCache = {
  conn: Connection | null
  promise: Promise<Mongoose> | null
  listenersBound: boolean
}

declare global {
  var mongooseCache: MongooseCache | undefined
}

const cache =
  globalThis.mongooseCache ??
  (globalThis.mongooseCache = {
    conn: null,
    promise: null,
    listenersBound: false,
  })

function bindConnectionListeners(connection: Connection) {
  if (cache.listenersBound) return

  connection.on('connected', () => {
    console.info('MongoDB connected successfully')
  })

  connection.on('error', error => {
    console.error(
      'MongoDB connection error. Please make sure MongoDB is running.',
      error
    )
  })

  cache.listenersBound = true
}

export async function connectDatabase() {
  if (cache.conn && cache.conn.readyState === 1) return cache.conn

  try {
    const mongodbUri = getRequiredEnv('MONGODB_URI')

    if (!cache.promise) cache.promise = mongoose.connect(mongodbUri)

    const mongooseInstance = await cache.promise
    const connection = mongooseInstance.connection

    bindConnectionListeners(connection)
    cache.conn = connection

    return connection
  } catch (error) {
    cache.promise = null
    cache.conn = null
    console.error(error)

    if (error instanceof Error && error.message.startsWith('Missing '))
      throw error

    throw new Error('Unable to connect to database')
  }
}
