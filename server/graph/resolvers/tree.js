const _ = require('lodash')
const graphHelper = require('../../helpers/graph')

const typeResolvers = {
  folder: 'TreeItemFolder',
  page: 'TreeItemPage',
  asset: 'TreeItemAsset'
}

const rePathName = /^[a-z0-9-]+$/
const reTitle = /^[^<>"]+$/

module.exports = {
  Query: {
    async tree (obj, args, context, info) {
      // Offset
      const offset = args.offset || 0
      if (offset < 0) {
        throw new Error('Invalid Offset')
      }

      // Limit
      const limit = args.limit || 100
      if (limit < 1 || limit > 100) {
        throw new Error('Invalid Limit')
      }

      // Order By
      const orderByDirection = args.orderByDirection || 'asc'
      const orderBy = args.orderBy || 'title'

      // Parse depth
      const depth = args.depth || 0
      if (depth < 0 || depth > 10) {
        throw new Error('Invalid Depth')
      }
      const depthCondition = depth > 0 ? `*{,${depth}}` : '*{0}'

      // Get parent path
      let parentPath = ''
      if (args.parentId) {
        const parent = await WIKI.db.knex('tree').where('id', args.parentId).first()
        if (parent) {
          parentPath = (parent.folderPath ? `${parent.folderPath}.${parent.fileName}` : parent.fileName).replaceAll('-', '_')
        }
      } else if (args.parentPath) {
        parentPath = args.parentPath.replaceAll('/', '.').replaceAll('-', '_').toLowerCase()
      }
      const folderPathCondition = parentPath ? `${parentPath}.${depthCondition}` : depthCondition

      // Fetch Items
      const items = await WIKI.db.knex('tree')
        .select(WIKI.db.knex.raw('tree.*, nlevel(tree."folderPath") AS depth'))
        .where(builder => {
          builder.where('folderPath', '~', folderPathCondition)
          if (args.includeAncestors) {
            const parentPathParts = parentPath.split('.')
            for (let i = 1; i <= parentPathParts.length; i++) {
              builder.orWhere({
                folderPath: _.dropRight(parentPathParts, i).join('.'),
                fileName: _.nth(parentPathParts, i * -1)
              })
            }
          }
        })
        .andWhere(builder => {
          if (args.types && args.types.length > 0) {
            builder.whereIn('type', args.types)
          }
        })
        .limit(limit)
        .offset(offset)
        .orderBy([
          { column: 'depth' },
          { column: orderBy, order: orderByDirection }
        ])

      return items.map(item => ({
        id: item.id,
        depth: item.depth,
        type: item.type,
        folderPath: item.folderPath.replaceAll('.', '/').replaceAll('_', '-'),
        fileName: item.fileName,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        ...(item.type === 'folder') && {
          childrenCount: 0
        }
      }))
    },
    async folderById (obj, args, context) {
      const folder = await WIKI.db.knex('tree')
        .select(WIKI.db.knex.raw('tree.*, nlevel(tree."folderPath") AS depth'))
        .where('id', args.id)
        .first()

      return {
        ...folder,
        folderPath: folder.folderPath.replaceAll('.', '/').replaceAll('_', '-'),
        childrenCount: 0
      }
    }
  },
  Mutation: {
    /**
     * CREATE FOLDER
     */
    async createFolder (obj, args, context) {
      try {
        WIKI.logger.debug(`Creating new folder ${args.pathName}...`)

        // Get parent path
        let parentPath = ''
        if (args.parentId) {
          const parent = await WIKI.db.knex('tree').where('id', args.parentId).first()
          parentPath = parent ? `${parent.folderPath}.${parent.fileName}` : ''
          if (parent) {
            parentPath = parent.folderPath ? `${parent.folderPath}.${parent.fileName}` : parent.fileName
          }
          parentPath = parentPath.replaceAll('-', '_')
        }

        // Validate path name
        if (!rePathName.test(args.pathName)) {
          throw new Error('ERR_INVALID_PATH_NAME')
        }

        // Validate title
        if (!reTitle.test(args.title)) {
          throw new Error('ERR_INVALID_TITLE')
        }

        // Check for collision
        const existingFolder = await WIKI.db.knex('tree').where({
          siteId: args.siteId,
          folderPath: parentPath,
          fileName: args.pathName
        }).first()
        if (existingFolder) {
          throw new Error('ERR_FOLDER_ALREADY_EXISTS')
        }

        // Create folder
        WIKI.logger.debug(`Creating new folder ${args.pathName} at path /${parentPath}...`)
        await WIKI.db.knex('tree').insert({
          folderPath: parentPath,
          fileName: args.pathName,
          type: 'folder',
          title: args.title,
          siteId: args.siteId
        })
        return {
          operation: graphHelper.generateSuccess('Folder created successfully')
        }
      } catch (err) {
        WIKI.logger.debug(`Failed to create folder: ${err.message}`)
        return graphHelper.generateError(err)
      }
    },
    /**
     * RENAME FOLDER
     */
    async renameFolder (obj, args, context) {
      try {
        // Get folder
        const folder = await WIKI.db.knex('tree').where('id', args.folderId).first()
        WIKI.logger.debug(`Renaming folder ${folder.id} path to ${args.pathName}...`)

        // Validate path name
        if (!rePathName.test(args.pathName)) {
          throw new Error('ERR_INVALID_PATH_NAME')
        }

        // Validate title
        if (!reTitle.test(args.title)) {
          throw new Error('ERR_INVALID_TITLE')
        }

        if (args.pathName !== folder.fileName) {
          // Check for collision
          const existingFolder = await WIKI.db.knex('tree')
            .whereNot('id', folder.id)
            .andWhere({
              siteId: folder.siteId,
              folderPath: folder.folderPath,
              fileName: args.pathName
            }).first()
          if (existingFolder) {
            throw new Error('ERR_FOLDER_ALREADY_EXISTS')
          }

          // Build new paths
          const oldFolderPath = (folder.folderPath ? `${folder.folderPath}.${folder.fileName}` : folder.fileName).replaceAll('-', '_')
          const newFolderPath = (folder.folderPath ? `${folder.folderPath}.${args.pathName}` : args.pathName).replaceAll('-', '_')

          // Update children nodes
          WIKI.logger.debug(`Updating parent path of children nodes from ${oldFolderPath} to ${newFolderPath} ...`)
          await WIKI.db.knex('tree').where('siteId', folder.siteId).andWhere('folderPath', oldFolderPath).update({
            folderPath: newFolderPath
          })
          await WIKI.db.knex('tree').where('siteId', folder.siteId).andWhere('folderPath', '<@', oldFolderPath).update({
            folderPath: WIKI.db.knex.raw(`'${newFolderPath}' || subpath(tree."folderPath", nlevel('${newFolderPath}'))`)
          })

          // Rename the folder itself
          await WIKI.db.knex('tree').where('id', folder.id).update({
            fileName: args.pathName,
            title: args.title
          })
        } else {
          // Update the folder title only
          await WIKI.db.knex('tree').where('id', folder.id).update({
            title: args.title
          })
        }

        WIKI.logger.debug(`Renamed folder ${folder.id} successfully.`)

        return {
          operation: graphHelper.generateSuccess('Folder renamed successfully')
        }
      } catch (err) {
        WIKI.logger.debug(`Failed to rename folder ${args.folderId}: ${err.message}`)
        return graphHelper.generateError(err)
      }
    },
    /**
     * DELETE FOLDER
     */
    async deleteFolder (obj, args, context) {
      try {
        // Get folder
        const folder = await WIKI.db.knex('tree').where('id', args.folderId).first()
        const folderPath = folder.folderPath ? `${folder.folderPath}.${folder.fileName}` : folder.fileName
        WIKI.logger.debug(`Deleting folder ${folder.id} at path ${folderPath}...`)

        // Delete all children
        const deletedNodes = await WIKI.db.knex('tree').where('folderPath', '<@', folderPath).del().returning(['id', 'type'])

        // Delete folders
        const deletedFolders = deletedNodes.filter(n => n.type === 'folder').map(n => n.id)
        if (deletedFolders.length > 0) {
          WIKI.logger.debug(`Deleted ${deletedFolders.length} children folders.`)
        }

        // Delete pages
        const deletedPages = deletedNodes.filter(n => n.type === 'page').map(n => n.id)
        if (deletedPages.length > 0) {
          WIKI.logger.debug(`Deleting ${deletedPages.length} children pages...`)

          // TODO: Delete page
        }

        // Delete assets
        const deletedAssets = deletedNodes.filter(n => n.type === 'asset').map(n => n.id)
        if (deletedAssets.length > 0) {
          WIKI.logger.debug(`Deleting ${deletedPages.length} children assets...`)

          // TODO: Delete asset
        }

        // Delete the folder itself
        await WIKI.db.knex('tree').where('id', folder.id).del()
        WIKI.logger.debug(`Deleted folder ${folder.id} successfully.`)

        return {
          operation: graphHelper.generateSuccess('Folder deleted successfully')
        }
      } catch (err) {
        WIKI.logger.debug(`Failed to delete folder ${args.folderId}: ${err.message}`)
        return graphHelper.generateError(err)
      }
    }
  },
  TreeItem: {
    __resolveType (obj, context, info) {
      return typeResolvers[obj.type] ?? null
    }
  }
}
