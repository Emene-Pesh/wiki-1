/* global WIKI */
// STUDENT EMENE FLAG: WHOLE FILE
// ------------------------------------
// JWT Token
// ------------------------------------

const JwtStrategy = require('passport-jwt').Strategy
const ExtractJwt = require('passport-jwt').ExtractJwt
// const _ = require('lodash')

module.exports = {
  init (passport, conf) {
    // conf is the definition.yml file in the same folder
    passport.use(conf.key,
      new JwtStrategy({
        algorithms: ['HS256'],
        secretOrKey: conf.jwtSecret,
        jwtFromRequest: ExtractJwt.fromUrlQueryParameter('jwt')
      }, async (jwtPayload, cb) => {
        try {
          if (jwtPayload.iat == null) {
            throw new WIKI.Error.AuthLoginFailed()
          }
          const millisElapsed = Date.now() - jwtPayload.iat * 1000
          const minutesElapsed = Math.floor(millisElapsed / 1000 / 60)
          if (minutesElapsed > 60) {
            throw new WIKI.Error.AuthLoginFailed()
          }
          const lowercaseGroups = jwtPayload.groups.map(str => str.toLowerCase())
          // Gets all the wikiJs groups
          const groupsArray = await WIKI.models.groups.query()
          // console.log('models groups', groupsArray)
          // match using the names and return the ids
          const ids = groupsArray.filter(dict => lowercaseGroups.includes(dict.name.toLowerCase())).map(dict => dict.id)
          // console.log(ids) // groups
          const user = await WIKI.models.users.processProfile({
            providerKey: '25033c4e-5e85-4a5e-a2b5-98b034a738df',
            /* the provider key is created when a new authentication strategy is added
            in the admin pannel of wiki.js.
            Administration -> Authentication -> JWT -> Callback URL / Redirect URL
            // is between the login/ and the /callback in the url
            */
            profile: {
              id: jwtPayload.id,
              email: jwtPayload.email,
              groups: ids
            }
          })
          process.nextTick(() => {
            cb(null, user)
          })
        } catch (err) {
          console.log('catch error')
          cb(err, null)
        }
      })
    )
  }
}
