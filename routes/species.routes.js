/**
 * Species and model_species routes, registered code-first through the
 * OpenAPI route registry.
 *
 * Both resources share `controller/species.controller.js`: species is the
 * taxonomy/GUI-display catalog, and model_species is the join table linking
 * ML models to the species they were trained on. Kept in one file since
 * they share a controller/service/repository boundary.
 *
 * @fileoverview Species and model_species resource routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/species.routes
 */

const fs = require('fs');
const path = require('path');

const multer = require('multer');
const sharp = require('sharp');

const speciesController = require('../controller/species.controller');
const logger = require('../logger/api.logger');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerOpenApiRoute } = require('../docs/openapi-route-registry');

/**
 * Directory the species picture files live in. Populated from the checked-in
 * set under `seed-data/species/images/` by the import migration, and where an
 * upload page will later write to.
 *
 * @constant
 * @type {string}
 */
const PICTURE_STORAGE_DIR = path.join(__dirname, '..', 'storage', 'species-pictures');

/**
 * Image types an upload may carry. Checked against the type the client claims
 * and against the file extension, so an executable renamed to `.png` is refused
 * rather than stored and later served back.
 *
 * @constant
 * @type {Object<string, Array<string>>}
 */
const UPLOADABLE_TYPES = {
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
};

/**
 * Width every stored picture is resized to.
 *
 * Not an arbitrary choice: all 646 pictures inherited from the annotation GUI
 * are exactly this wide, because the species buttons are laid out around it.
 * Resizing on the way in is what keeps an uploaded photograph consistent with
 * them instead of making whoever uploads it resize by hand.
 *
 * @constant
 * @type {number}
 */
const PICTURE_WIDTH = 244;

/**
 * Width of the thumbnail served for a picture grid.
 *
 * A grid asks for a couple of hundred pictures at once, and at full size that
 * is a visible stall; at this width each one is a few kilobytes.
 *
 * @constant
 * @type {number}
 */
const THUMBNAIL_WIDTH = 96;

/**
 * Smallest source image worth accepting, in pixels.
 *
 * Anything below this has to be enlarged so far to reach
 * {@link PICTURE_WIDTH} that the result is not usable, so it is refused with a
 * clear reason rather than stored as a blurry smear.
 *
 * @constant
 * @type {Object<string, number>}
 */
const MIN_SOURCE_SIZE = { width: 120, height: 80 };

/**
 * Output format per source format, and the MIME type that goes with it.
 *
 * The source format is kept where it survives a resize, because a photograph is
 * far smaller as JPEG than as PNG. GIF is converted: an animated GIF does not
 * resize meaningfully, and a species button has no use for animation.
 *
 * @constant
 * @type {Object<string, {format: string, contentType: string, extension: string}>}
 */
const OUTPUT_FORMATS = {
    png: { format: 'png', contentType: 'image/png', extension: '.png' },
    jpeg: { format: 'jpeg', contentType: 'image/jpeg', extension: '.jpg' },
    webp: { format: 'webp', contentType: 'image/webp', extension: '.webp' },
    gif: { format: 'png', contentType: 'image/png', extension: '.png' },
};

/**
 * Largest picture an upload may carry. The 646 imported pictures average around
 * 77 KB and the biggest is well under this, so 10 MB leaves generous room for a
 * higher-resolution photograph without letting a mistake fill the disk.
 *
 * @constant
 * @type {number}
 */
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;

/**
 * Most pictures one request may add. A species has one or two in practice;
 * this exists so a runaway client cannot post hundreds in a single call.
 *
 * @constant
 * @type {number}
 */
const MAX_PICTURES_PER_REQUEST = 10;

/**
 * Multipart handler for picture uploads.
 *
 * Files are buffered in memory rather than written straight to disk, because
 * the stored filename depends on the species and on how many pictures it
 * already has -- neither of which is known until the species has been looked
 * up. The size limit keeps that bounded.
 *
 * @constant
 */
const pictureUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PICTURE_BYTES, files: MAX_PICTURES_PER_REQUEST },
    fileFilter: (req, file, callback) => {
        const extensions = UPLOADABLE_TYPES[file.mimetype];
        const extension = path.extname(file.originalname).toLowerCase();

        if (!extensions || !extensions.includes(extension)) {
            callback(new ApiError(
                400,
                ERROR_CODES.VALIDATION_ERROR,
                `${file.originalname} is not an accepted image. Accepted types: ${Object.keys(UPLOADABLE_TYPES).join(', ')}.`
            ));
            return;
        }

        callback(null, true);
    },
}).array('pictures', MAX_PICTURES_PER_REQUEST);

/**
 * Wraps the multer middleware so its own errors arrive as the API's error
 * contract rather than as an unhandled 500.
 *
 * Multer reports a file that is too large through a callback, not a thrown
 * error, so without this a 10 MB limit breach would surface as a generic
 * server error with nothing telling the caller what to do about it.
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {Function} next - Express next handler.
 * @returns {void}
 */
function handlePictureUpload(req, res, next) {
    pictureUpload(req, res, (error) => {
        if (!error) {
            next();
            return;
        }

        if (error instanceof ApiError) {
            next(error);
            return;
        }

        if (error.code === 'LIMIT_FILE_SIZE') {
            next(new ApiError(
                400,
                ERROR_CODES.VALIDATION_ERROR,
                `Each picture must be ${MAX_PICTURE_BYTES / (1024 * 1024)} MB or smaller.`
            ));
            return;
        }

        if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
            next(new ApiError(
                400,
                ERROR_CODES.VALIDATION_ERROR,
                `Send at most ${MAX_PICTURES_PER_REQUEST} files, all under the field name "pictures".`
            ));
            return;
        }

        next(error);
    });
}

/**
 * Register every `/api/species` and `/api/model_species` route and its
 * OpenAPI operation on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerSpeciesRoutes(app) {
    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/species',
        summary: 'Fetch all species',
        description:
            'Returns every species record used for taxonomy, GUI display configuration, and ML model training labels. An empty array may indicate either that no records exist or that the database query failed.',
        tags: ['V1 · Species'],
        responses: {
            200: {
                description: 'Species list returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/Species' } },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.getSpecies();
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/species/by-comname/:comname',
        summary: 'Fetch a species by common name',
        description:
            'Returns the species record whose comname matches the supplied value, case-insensitively. Returns null both when no species matches and when the database query fails.',
        tags: ['V1 · Species'],
        parameters: [
            {
                in: 'path',
                name: 'comname',
                required: true,
                schema: { type: 'string' },
                description: 'Common name to match, case-insensitively.',
            },
        ],
        responses: {
            200: {
                description: 'Matching species returned, or null if not found.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/Species' }, { type: 'null' }] },
                    },
                },
            },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.getSpeciesByComname(req, res);
            res.json(data);
        }),
    });

    // -----------------------------------------------------------------
    // Annotation lists and species pictures
    //
    // Registration order matters: every literal path here is registered
    // before `/api/species/:id` below, otherwise Express matches
    // `GET /api/species/lists` against that route with id = 'lists'.
    // -----------------------------------------------------------------

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/species/lists',
        summary: 'List the annotation species lists',
        description:
            'Returns the annotation lists a species can belong to, with how many entries each holds. Entries with no list are excluded: those are historical records kept only because machine-learning metrics reference them, and nothing should offer them for annotation.',
        tags: ['V1 \u00b7 Species'],
        responses: {
            200: {
                description: 'Lists returned successfully.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                type: 'object',
                                required: ['species_list', 'entry_count'],
                                properties: {
                                    species_list: { type: 'string', example: 'GULF_Inverts', description: 'Name of the list.' },
                                    entry_count: { type: 'integer', example: 177, description: 'How many entries the list holds.' },
                                },
                            },
                        },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.getSpeciesLists();
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/species/list/:list',
        summary: 'Fetch every entry on one annotation list',
        description:
            'Returns every entry on the named list with its pictures, ordered by main tab, then sub-tab, then item order, so a client can build its tab tree straight from the response. Entries whose item order covers several placements (an underscore-delimited value such as `17_4`) sort last within their group, because that order only means something once the client splits it.',
        tags: ['V1 \u00b7 Species'],
        parameters: [
            {
                in: 'path',
                name: 'list',
                required: true,
                schema: { type: 'string' },
                description: "Name of the list, as returned by GET /api/species/lists (e.g. 'Fish').",
            },
        ],
        responses: {
            200: {
                description: 'Entries returned successfully. An empty array when the list does not exist.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/SpeciesWithPictures' } },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.getSpeciesByList(req.params.list);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/species/list/:list/search',
        summary: 'Search one annotation list by name',
        description:
            'Case-insensitive substring search over common name, scientific name and GUI display name, scoped to one list. Scoped deliberately: a common name is not unique across the seven lists -- ITIS serial 169237 is "UI croaker" on Fish and "Drum" on GULF_Fish.',
        tags: ['V1 \u00b7 Species'],
        parameters: [
            {
                in: 'path',
                name: 'list',
                required: true,
                schema: { type: 'string' },
                description: 'Name of the list to search within.',
            },
            {
                in: 'query',
                name: 'q',
                required: true,
                schema: { type: 'string', minLength: 1 },
                description: 'Substring to match.',
            },
        ],
        responses: {
            200: {
                description: 'Matching entries returned successfully.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/SpeciesWithPictures' } },
                    },
                },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const query = (req.query.q || '').trim();

            // Rejected rather than treated as "match everything": an empty
            // search returning all 224 entries reads as a working search.
            if (query === '') {
                throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A non-empty q query parameter is required.');
            }

            const data = await speciesController.searchSpeciesInList(req.params.list, query);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/species/list/:list/taxserial/:taxserial',
        summary: 'Fetch one entry by list and taxserial',
        description:
            'Returns the single entry identified by a list and a taxserial. Both are needed: taxserial alone does not identify an entry, because values below 10000 are local codes invented per list and reused across lists -- taxserial 55 is a rockfish complex on Fish, a coral on GULF_Inverts and metal debris on MarineDebris.',
        tags: ['V1 \u00b7 Species'],
        parameters: [
            {
                in: 'path',
                name: 'list',
                required: true,
                schema: { type: 'string' },
                description: 'Name of the list the entry belongs to.',
            },
            {
                in: 'path',
                name: 'taxserial',
                required: true,
                schema: { type: 'integer' },
                description: 'Taxserial within that list.',
            },
        ],
        responses: {
            200: {
                description: 'The matching entry.',
                content: {
                    'application/json': { schema: { $ref: '#/components/schemas/SpeciesWithPictures' } },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.getSpeciesByListAndTaxserial(
                req.params.list, req.params.taxserial
            );

            if (!data) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `No ${req.params.list} entry with taxserial ${req.params.taxserial} was found.`
                );
            }

            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/species/pictures/:pictureId',
        summary: 'Fetch a species picture',
        description:
            'Serves the picture file itself, with the Content-Type recorded for it. Responses carry a strong ETag and a long Cache-Control, because a species grid asks for a couple of hundred pictures at once and without them every tab switch re-downloads all of them. A picture never changes once stored -- a replacement is a new record with a new id -- so the ETag is derived from the record rather than the file contents.',
        tags: ['V1 \u00b7 Species'],
        parameters: [
            {
                in: 'path',
                name: 'pictureId',
                required: true,
                schema: { type: 'integer' },
                description: 'Identifier of the picture, from a species response or GET /api/species/{id}/pictures.',
            },
        ],
        responses: {
            200: {
                description: 'The picture file.',
                content: {
                    'image/png': { schema: { type: 'string', format: 'binary' } },
                    'image/jpeg': { schema: { type: 'string', format: 'binary' } },
                },
            },
            304: { description: 'Not modified; the client\'s cached copy is current.' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const picture = await speciesController.getPictureById(req.params.pictureId);

            if (!picture) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Species picture ${req.params.pictureId} was not found.`
                );
            }

            const filePath = path.join(PICTURE_STORAGE_DIR, picture.filename);

            // The row can outlive the file if storage is restored separately
            // from the database. Answering 404 is more useful than a stack
            // trace from sendFile.
            if (!fs.existsSync(filePath)) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Species picture ${req.params.pictureId} is recorded but its file is missing from storage.`
                );
            }

            res.type(picture.content_type);
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            res.setHeader('ETag', `"species-picture-${picture.id}"`);

            if (req.headers['if-none-match'] === `"species-picture-${picture.id}"`) {
                res.status(304).end();
                return;
            }

            res.sendFile(filePath);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/species/:id/pictures',
        summary: 'Upload pictures for a species',
        description:
            `Accepts one or more images as multipart/form-data under the field name "pictures", and stores each resized to ${PICTURE_WIDTH} pixels wide with its aspect ratio kept. That width is not arbitrary: every picture inherited from the annotation GUI is exactly ${PICTURE_WIDTH} wide, because the species buttons are laid out around it, so resizing here is what keeps an uploaded photograph consistent with the rest instead of making the uploader resize by hand. `
            + `Each file is vetted before anything is written: it must decode as a real image, be at least ${MIN_SOURCE_SIZE.width}x${MIN_SOURCE_SIZE.height} (below that it would have to be enlarged too far to be usable), and be no larger than ${MAX_PICTURE_BYTES / (1024 * 1024)} MB. PNG, JPEG and WebP keep their format; GIF is converted to PNG, since an animated GIF does not resize meaningfully and a button has no use for animation. The first picture a species receives becomes its default.`,
        tags: ['V1 · Species'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'species.id to attach the pictures to.',
            },
        ],
        requestBody: {
            required: true,
            content: {
                'multipart/form-data': {
                    schema: {
                        type: 'object',
                        required: ['pictures'],
                        properties: {
                            pictures: {
                                type: 'array',
                                maxItems: MAX_PICTURES_PER_REQUEST,
                                items: { type: 'string', format: 'binary' },
                                description: `Up to ${MAX_PICTURES_PER_REQUEST} image files.`,
                            },
                        },
                    },
                },
            },
        },
        responses: {
            201: {
                description: 'The pictures that were stored.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/SpeciesPicture' } },
                    },
                },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: [
            handlePictureUpload,
            asyncHandler(async (req, res) => {
                const files = req.files || [];

                if (files.length === 0) {
                    throw new ApiError(
                        400,
                        ERROR_CODES.VALIDATION_ERROR,
                        'Attach at least one image under the field name "pictures".'
                    );
                }

                /** @type {Array<Object>} */
                const stored = [];

                for (const file of files) {
                    // Decoding is the real check. The declared MIME type and the
                    // extension are both client-supplied and neither proves the
                    // bytes are an image.
                    let metadata;
                    try {
                        metadata = await sharp(file.buffer).metadata();
                    } catch (decodeError) {
                        throw new ApiError(
                            400,
                            ERROR_CODES.VALIDATION_ERROR,
                            `${file.originalname} could not be read as an image.`
                        );
                    }

                    if (metadata.width < MIN_SOURCE_SIZE.width || metadata.height < MIN_SOURCE_SIZE.height) {
                        throw new ApiError(
                            400,
                            ERROR_CODES.VALIDATION_ERROR,
                            `${file.originalname} is ${metadata.width}x${metadata.height}, below the `
                            + `${MIN_SOURCE_SIZE.width}x${MIN_SOURCE_SIZE.height} minimum. It would have to be `
                            + `enlarged too far to reach ${PICTURE_WIDTH}px wide to be usable.`
                        );
                    }

                    const output = OUTPUT_FORMATS[metadata.format];
                    if (!output) {
                        throw new ApiError(
                            400,
                            ERROR_CODES.VALIDATION_ERROR,
                            `${file.originalname} decoded as ${metadata.format}, which is not an accepted format.`
                        );
                    }

                    const resized = await sharp(file.buffer)
                        .resize({ width: PICTURE_WIDTH })
                        .toFormat(output.format)
                        .toBuffer();

                    const resizedMetadata = await sharp(resized).metadata();

                    // Record first so the filename is allocated under the
                    // unique index, then write. The reverse order could hand two
                    // concurrent uploads the same name.
                    const picture = await speciesController.createPicture({
                        speciesId: req.params.id,
                        extension: output.extension,
                        originalName: file.originalname,
                        contentType: output.contentType,
                        byteSize: resized.length,
                        width: resizedMetadata.width,
                        height: resizedMetadata.height,
                    });

                    if (!picture) {
                        throw new ApiError(
                            404,
                            ERROR_CODES.RESOURCE_NOT_FOUND,
                            `Species ${req.params.id} was not found.`
                        );
                    }

                    fs.mkdirSync(PICTURE_STORAGE_DIR, { recursive: true });

                    try {
                        fs.writeFileSync(path.join(PICTURE_STORAGE_DIR, picture.filename), resized);
                    } catch (writeError) {
                        // Leaving the row behind would mean a record with no
                        // file, which serves 404s forever.
                        await speciesController.deletePicture(picture.id);
                        throw writeError;
                    }

                    stored.push(picture);
                }

                res.status(201).json(stored);
            }),
        ],
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/species/pictures/:pictureId/thumbnail',
        summary: 'Fetch a small version of a species picture',
        description:
            `Serves the picture resized to ${THUMBNAIL_WIDTH} pixels wide, for a grid that shows a couple of hundred at once. Generated on request and cached by the client through the same immutable ETag as the full-size route, since a stored picture never changes -- a replacement is a new record with a new id.`,
        tags: ['V1 · Species'],
        parameters: [
            {
                in: 'path',
                name: 'pictureId',
                required: true,
                schema: { type: 'integer' },
                description: 'Identifier of the picture.',
            },
        ],
        responses: {
            200: {
                description: 'The thumbnail.',
                content: {
                    'image/png': { schema: { type: 'string', format: 'binary' } },
                    'image/jpeg': { schema: { type: 'string', format: 'binary' } },
                },
            },
            304: { description: 'Not modified; the client\'s cached copy is current.' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const picture = await speciesController.getPictureById(req.params.pictureId);

            if (!picture) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Species picture ${req.params.pictureId} was not found.`
                );
            }

            const filePath = path.join(PICTURE_STORAGE_DIR, picture.filename);

            if (!fs.existsSync(filePath)) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Species picture ${req.params.pictureId} is recorded but its file is missing from storage.`
                );
            }

            const etag = `"species-picture-thumb-${picture.id}"`;
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            res.setHeader('ETag', etag);

            if (req.headers['if-none-match'] === etag) {
                res.status(304).end();
                return;
            }

            const thumbnail = await sharp(filePath)
                .resize({ width: THUMBNAIL_WIDTH })
                .toBuffer();

            res.type(picture.content_type);
            res.send(thumbnail);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/species/pictures/:pictureId/default',
        summary: 'Make a picture the species default',
        description:
            "Marks this picture as the one to show when only one is wanted, clearing whichever picture held that role before. Exactly one picture per species can be the default, so this is how the choice is changed rather than by editing the flag directly. The imported set defaulted to the alphabetically first file, which the GUI effectively chose at random.",
        tags: ['V1 · Species'],
        parameters: [
            {
                in: 'path',
                name: 'pictureId',
                required: true,
                schema: { type: 'integer' },
                description: 'Identifier of the picture to make the default.',
            },
        ],
        responses: {
            200: {
                description: 'The updated picture record.',
                content: {
                    'application/json': { schema: { $ref: '#/components/schemas/SpeciesPicture' } },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const picture = await speciesController.setDefaultPicture(req.params.pictureId);

            if (!picture) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Species picture ${req.params.pictureId} was not found.`
                );
            }

            res.json(picture);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'delete',
        path: '/api/species/pictures/:pictureId',
        summary: 'Delete a species picture',
        description:
            "Removes the picture record and its file. If the deleted picture was the species' default and other pictures remain, the oldest remaining one becomes the default, so a species with pictures always has one -- an ambiguous default is the problem this table exists to avoid.",
        tags: ['V1 · Species'],
        parameters: [
            {
                in: 'path',
                name: 'pictureId',
                required: true,
                schema: { type: 'integer' },
                description: 'Identifier of the picture to delete.',
            },
        ],
        responses: {
            200: {
                description: 'The deleted picture record.',
                content: {
                    'application/json': { schema: { $ref: '#/components/schemas/SpeciesPicture' } },
                },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const deleted = await speciesController.deletePicture(req.params.pictureId);

            if (!deleted) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `Species picture ${req.params.pictureId} was not found.`
                );
            }

            // The record is already gone, so a failure to unlink must not turn
            // into a 500: that would report the delete as having failed when it
            // succeeded. A leftover file is recoverable; a misleading error is
            // worse.
            const filePath = path.join(PICTURE_STORAGE_DIR, deleted.filename);
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (unlinkError) {
                logger.error(
                    `Deleted species picture ${deleted.id} but could not remove ${deleted.filename}: ${unlinkError.message}`
                );
            }

            res.json(deleted);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/species/:id/pictures',
        summary: 'List the pictures recorded for a species',
        description:
            'Returns the picture records for one species, the default first. The bytes are fetched separately from GET /api/species/pictures/{pictureId}.',
        tags: ['V1 \u00b7 Species'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'species.id to list pictures for.',
            },
        ],
        responses: {
            200: {
                description: 'Picture records returned successfully. An empty array when the species has none.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/SpeciesPicture' } },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.getPicturesForSpecies(req.params.id);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/species/:id',
        summary: 'Fetch a species by id',
        description:
            "Returns a single species record by id, or null if not found. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · Species'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'id of the species record to fetch.',
            },
        ],
        responses: {
            200: {
                description: 'The matching species record, or null if not found.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/Species' }, { type: 'null' }] },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.getSpeciesById(req.params.id);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/species',
        summary: 'Create a new species record',
        description:
            "Creates a new species record. The caller must supply a unique taxserial (see the species_taxserial_idx unique index in model/species.model.js). A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · Species'],
        requestBody: {
            required: true,
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/SpeciesCreateRequest' } },
            },
        },
        responses: {
            200: {
                description: 'The created species record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Species' } } },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            // Insert failure (e.g. the species_taxserial_idx unique
            // constraint) rejects rather than swallowing to a fallback.
            const data = await speciesController.createSpecies(req.body.species);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/species/:id',
        summary: 'Update an existing species record',
        description:
            "Updates an existing species record by id. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · Species'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'id of the species record to update.',
            },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/SpeciesUpdateRequest' } },
            },
        },
        responses: {
            200: {
                description: 'The updated species record, or null if no species matched the given id.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/Species' }, { type: 'null' }] },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.updateSpecies(req.params.id, req.body.species);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'delete',
        path: '/api/species/:id',
        summary: 'Delete a species record',
        description:
            "Deletes a species record by id. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · Species'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'id of the species record to delete.',
            },
        ],
        responses: {
            200: { description: 'The number of rows destroyed (as returned by Sequelize).' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.deleteSpecies(req.params.id);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'post',
        path: '/api/model_species',
        summary: 'Create a model-species linkage record',
        description:
            'Creates a model_species join record linking an ML model to a species, using the request body directly as the record to insert. Note that when the insert fails the response body is an ErrorResponse-shaped object, but the endpoint currently still responds with HTTP 200 rather than an error status.',
        tags: ['V1 · Species'],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['model_id', 'species_id'],
                        properties: {
                            model_id: { type: 'integer', example: 7 },
                            species_id: { type: 'integer', example: 42 },
                            dataset_size: { type: 'integer', nullable: true },
                            balance_weight: { type: 'number', format: 'float', nullable: true },
                            precision_mean: { type: 'number', format: 'float', nullable: true },
                            recall_mean: { type: 'number', format: 'float', nullable: true },
                            f1_mean: { type: 'number', format: 'float', nullable: true },
                            notes: { type: 'string', nullable: true },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Model-species record created successfully.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ModelSpecies' } } },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            // Unlike every wrapped-body domain ({ species: {...} }, etc.),
            // this route's body IS the model_species record directly.
            const data = await speciesController.createModelSpecies(req, res);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'get',
        path: '/api/model_species/:id',
        summary: 'Fetch a model_species record by id',
        description:
            "Returns a single model_species join record by ID, or null if not found. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · Species'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'ID of the model_species record to fetch.',
            },
        ],
        responses: {
            200: {
                description: 'The matching model_species record.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ModelSpecies' } } },
            },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.getModelSpeciesById(req.params.id);

            if (!data) {
                throw new ApiError(
                    404,
                    ERROR_CODES.RESOURCE_NOT_FOUND,
                    `ModelSpecies ${req.params.id} was not found.`
                );
            }

            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'put',
        path: '/api/model_species/:id',
        summary: 'Update an existing model_species record',
        description:
            "Updates an existing model_species join record by ID. The request body fields are used directly (unwrapped), matching the POST /model_species convention. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · Species'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'ID of the model_species record to update.',
            },
        ],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ModelSpecies' } } },
        },
        responses: {
            200: {
                description: 'The updated model_species record, or null if no row matched the given ID.',
                content: {
                    'application/json': {
                        schema: { oneOf: [{ $ref: '#/components/schemas/ModelSpecies' }, { type: 'null' }] },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.updateModelSpecies(req.params.id, req.body);
            res.json(data);
        }),
    });

    registerOpenApiRoute(app, {
        method: 'delete',
        path: '/api/model_species/:id',
        summary: 'Delete a model_species record',
        description:
            "Deletes a model_species join record by ID. A database failure rejects the returned promise, so the route's .catch() responds with HTTP 500 in that case.",
        tags: ['V1 · Species'],
        parameters: [
            {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
                description: 'ID of the model_species record to delete.',
            },
        ],
        responses: {
            200: { description: 'The number of rows destroyed (as returned by Sequelize).' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await speciesController.deleteModelSpecies(req.params.id);
            res.json(data);
        }),
    });
}

module.exports = registerSpeciesRoutes;
