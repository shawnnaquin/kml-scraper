"use strict";

const path = require( 'path' );
const fse = require( 'fs-extra' );
const glob = require( 'glob' );
const zip = require( 'bestzip' );

const PKG =  require( path.resolve( __dirname, '../package.json' ) );

const version = PKG.version;
const CONFIG = PKG.config;

const DISTFOLDER = CONFIG.DISTFOLDER;
const DISTRIBUTIONZIPFOLDER = CONFIG.DISTRIBUTIONZIPFOLDER;
const SIMPLEFOLDER = CONFIG.DISTSIMPLEFOLDER;

const DISTDIR = path.resolve( __dirname, `../${DISTFOLDER}`);

const ZIPFOLDER = path.join( DISTDIR, DISTRIBUTIONZIPFOLDER );
const SRCZIPFOLDER = path.join( DISTDIR, SIMPLEFOLDER );

const DATE = new Date().getFullYear();

process.stdout.write( `... spooling... ${ZIPFOLDER}/*-${DATE}-${version}.zip\r\n` );

fse.removeSync( ZIPFOLDER );
fse.ensureDir( ZIPFOLDER );

glob( `${SRCZIPFOLDER}/*`, { }, ( err, folders ) => {

    let promiseArray = [];

    for( let $FOLDER of folders) {

        let name = $FOLDER.split('/')[$FOLDER.split('/').length-1];
        let zipName = `${ DISTRIBUTIONZIPFOLDER }/${ name }-${DATE}-${ version }.zip`;

        promiseArray.push(

            new Promise( ( resolve, reject ) => {

                zip({

                    source: `${SIMPLEFOLDER}/*`,
                    destination: zipName,
                    cwd: DISTDIR

                }).then( () => {
                    // it be zipped!
                    process.stdout.write( `done! ${zipName}                                             \r\n` );
                    resolve(`${zipName}`);
                }).catch( ( err ) => {
                    // console.error( err.stack );
                    reject(`${zipName}: ${err.stack}`);
                });

            }).then( ()=> {
            }).catch( (err) => {
                process.stdout.write(`${zipName}: ${err.stack}\r\n`);
            })
        )

    }

    Promise.all( promiseArray )
        .then( ( ) => {
            process.stdout.write( `zipping zips!                                             \r\n` );

            zip({

                source: `*`,
                destination: `all-simplified-boundaries-${DATE}-${version}.zip`,
                cwd: ZIPFOLDER

            }).then( () => {
                // it be zipped!
                process.stdout.write('all done                                                             \r\n');
                process.exit();
            }).catch( ( err ) => {
                // console.error( err.stack );
            });
        });

});