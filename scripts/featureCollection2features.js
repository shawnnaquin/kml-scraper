const fse = require('fs-extra');
const path = require('path');
const xmlReader = require('read-xml');
const convert = require('xml-js');

const CONFIG = require( path.resolve( __dirname, '../package.json') ).config;

const SRCFOLDER = CONFIG.SRCFOLDER;
const SRCFIPS = CONFIG.SRCFIPS;
const SRCDMAINFO = CONFIG.SRCDMAINFO;

const DISTFOLDER = CONFIG.DISTFOLDER;
const DISTTEMPFOLDER = CONFIG.DISTTEMPFOLDER;
const DISTCOMPLEXFOLDER = CONFIG.DISTCOMPLEXFOLDER;
const DISTSIMPLEFOLDER = CONFIG.DISTSIMPLEFOLDER;

const statefips = require( path.resolve( __dirname, `../${SRCFOLDER}/${SRCFIPS}` ) );

let type = ['--dma']
    .filter( (el) => { if( process.argv.includes(el) ) {
        return el;
    } }  )[0].replace('--','');

const DIST = path.resolve( __dirname, `../${DISTFOLDER}/${DISTCOMPLEXFOLDER}/${type}` );
const SRCFILE = eval(`process.env.npm_package_config_SRC${type.toLocaleUpperCase()}`);
const FILE = path.resolve( __dirname, `../${DISTFOLDER}/${DISTTEMPFOLDER}/${type}/${SRCFILE}` );

const dmaFile = type === 'dma' ?  path.resolve( __dirname, `../${SRCFOLDER}/${SRCDMAINFO}` ) : null;
const dmainfo =  type === 'dma' ? JSON.parse(fse.readFileSync( dmaFile ) ) : null;

fse.remove( DIST );

process.stdout.write( `reading json... \r\n` );

let stream = fse.createReadStream( FILE, {flags: 'r', encoding: 'utf-8'} );

class Template {
    constructor() {
        this.type="FeatureCollection";
        this.features = [];
    }
}

let content = '';

let total = 0;
// let current = 0;
// let percent = 0;

// let percentBar = () => {
//
//     current += 1;
//     percent = current/total*100;
//
// };

let done = () => {

    process.stdout.write( `parsing json... \r\n` );
    content = JSON.parse( content );

    total = Object.keys( content.features ).length;

    process.stdout.write( `parsed!\r\n`);
    process.stdout.write( `processing: ${total} zones...      \r\n` );

    // let tempArray = [];

    for( $feature of content.features ) {

        let $template = new Template();
        $template.features.push( $feature );

        let $file = JSON.stringify( $template );
        let $id = $feature.properties.dma ? $feature.properties.dma : $feature.properties.name;

        if ( type === 'dma' && dmainfo && dmainfo[$id] ) {
            dmainfo[$id] = {
                ...dmainfo[$id],
                ...$feature.properties
            };
        }

        fse.writeFile( dmaFile, JSON.stringify( dmainfo, null, 4 ), ( err, data ) => {
            if (err) { console.log( err ) }
        });

        fse.ensureDir( DIST )
            .then( ( ) => {
                const FILE = path.join( DIST, `/${$id}.json` );
                fse.ensureFile( FILE )
                    .then( ( ) => {
                        fse.writeFile( FILE, $file, ( err, data ) => {
                            if (err) {
                                console.log( err );
                            } else {
                                // percentBar();
                            }
                        });
                    })
                    .catch( err => {
                        console.error( err )
                    })
            })
            .catch( err => {
                console.error( err )
            });

    }

    console.log( 'done!' );
};

stream.on( 'data', ( data ) => {
    content += data.toString();
});

stream.on( 'end', ( ) => {
    done();
});

