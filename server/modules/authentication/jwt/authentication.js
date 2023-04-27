/* global WIKI */

// ------------------------------------
// JWT Token
// ------------------------------------

const JwtStrategy = require('passport-jwt').Strategy
const ExtractJwt = require('passport-jwt').ExtractJwt

module.exports = {
  init (passport, conf) {
    passport.use(conf.key,
      new JwtStrategy({
        algorithms: ['HS256'],
        secretOrKey: conf.jwtSecret,
        jwtFromRequest: ExtractJwt.fromUrlQueryParameter('auth_token')
      }, async (jwtPayload, cb) => {
        try {
          const user = await WIKI.models.users.processProfile({
            providerKey: 'cd2d2d60-7cb2-4c9d-9cc4-9e6b66502745',
            /* the provider key is created when a new authentication strategy is added
            in the admin pannel of wiki.js.
            to access it you can use console.log(WIKI.auth.strategies)
            or go to domainOfWiki/login , click JWT , and the key will be after the login/
            eg: http://localhost:3000/login/cd2d2d60-7cb2-4c9d-9cc4-9e6b66502745
            */
            profile: {
              id: jwtPayload.id,
              email: jwtPayload.email
            }
          })
          cb(null, user)
        } catch (err) {
          cb(err, null)
        }
      })
    )
  }
}
