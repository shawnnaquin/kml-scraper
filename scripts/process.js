const fse = require('fs-extra');
const path = require('path');
const xmlReader = require('read-xml');
const convert = require('xml-js');
const readdirp = require('readdirp');

const CONFIG = require( path.resolve( __dirname, '../package.json') ).config;

const DISTFOLDER = CONFIG.DISTFOLDER;
const DISTTEMPFOLODER = CONFIG.DISTTEMPFOLDER;
const DISTCOMPLEXFOLDER = CONFIG.DISTCOMPLEXFOLDER;
const DISTSIMPLEFOLDER = CONFIG.DISTSIMPLEFOLDER;

const SRCFOLDER = CONFIG.SRCFOLDER;
const SRCFIPS = CONFIG.SRCFIPS;
const SRCABBREV = CONFIG.SRCABBREV;
const statefips = require( `../${SRCFOLDER}/${SRCFIPS}` );
const stateabbrev = require( `../${SRCFOLDER}/${SRCABBREV}` );

const SRCCOUNTY = path.resolve( __dirname, `../${SRCFOLDER}/${CONFIG.SRCCOUNTY}`);
const SRCZCTA = path.resolve( __dirname, `../${SRCFOLDER}/${CONFIG.SRCZCTA}`);
const SRCCITYFOLDER = path.resolve( __dirname, `../${SRCFOLDER}/${CONFIG.SRCCITYFOLDER}` );
const nameParser = require( path.resolve( __dirname, `../utilities/scriptutils.js`) ).nameparser;

let type = ['--county','--zip', '--city', '--neighborhood']
    .filter( (el) => { if( process.argv.includes(el) ) return el; }  )[0].replace('--','');

const SRCNEIGHBORHOODFOLDER = path.resolve( __dirname, `../${DISTFOLDER}/${DISTTEMPFOLODER}/${type}` );

const DIST = path.resolve( __dirname, `../${DISTFOLDER}/${DISTCOMPLEXFOLDER}/${type}/` );

let FILES =  [ ];
let FILES2 = [ ];

let promiseArray = [ ];
let dataArray = [ ];

let bar = '[------------------------------]';

let start = ( ) => {

    fse.removeSync( DIST );

    fse.ensureDir( DIST )
        .then( ()=> {

            // if ( type !== 'neighborhood' ) {

                FILES2 = [...FILES];

                for ( FILE of FILES ) {

                    promiseArray.push(
                        streamFile( FILE, promiseArray.length+1 )
                    )

                }


                Promise.all( promiseArray )
                    .then( (v) => {
                        process.stdout.write('\n');
                        process.stdout.write(`done!\n`);
                    });

            // } else {
            //     let i = 0;
            //     for ( FILE of FILES ) {
            //         i+=1;
            //
            //         ( async () =>  {
            //             return await streamFile(FILE, i);
            //         })();
            //     }
            // }



        }).catch( (err) => {
            console.log( err );
        });

};

let percentBar = ( message=" reading  ", cur=0, total=0, percent=0, done=0 ) => {

    let per = Math.round( percent * 0.3 )+1;
    bar = bar.split('').fill( '#', 1, per );
    bar = bar.join('')

    process.stdout.write( `... ${message} ...    ${percent}% ${bar} ${100-percent}%         ${done} - ${total}     \r` );
};

let streamFile = ( FILE, idx ) => new Promise( ( resolve, reject ) => {

        let decodedXMLStream = fse.createReadStream( FILE ).pipe(
            xmlReader.createStream()
        );

        dataArray[idx] = {data:''};
        process.stdout.write(`...  reading  ...\r`);

        decodedXMLStream.on( 'data', ( xmlStr ) => {
            dataArray[idx].data += xmlStr.replace(/\r?\n|\r/g, '');
        });

        decodedXMLStream.on( 'end', () => {
            processFile( FILE, idx, dataArray[idx].data, resolve, reject );
            // console.log('decoded');
        });

});

let processFile = ( FILE, idx, data, resolve, reject ) => {

    // process.stdout.write(`... converting ...\r`);

    let xml = data;
    let result = JSON.parse( convert.xml2json( xml, { compact: true, spaces: 4 } ) );
    let places;

    if ( !result.kml.Document.Folder ) {
        let obj = result.kml.Document.Document;
        delete result.kml.Document.Document;
        result.kml.Document.Folder = obj;
        places = result.kml.Document.Folder.Placemark;

    } else {
         places = result.kml.Document.Folder.Placemark
    }

    let dupes = [];

    if ( !Array.isArray( places ) ) {
        places = [places];
    }

    let total = Object.keys(places).length;
    let currentKey = 0;


    Object.keys( places ).forEach( ( place, placeIndex ) => {

        let $item = places[place];
        // let $item = places[0];
        let normalizedStateName;

        let rawName = $item.name._text ? $item.name._text : $item.name._cdata;
        let rawSplitName = rawName.split('<at><openparen>')[1] ? rawName.split('<at><openparen>')[1].split('<closeparen>')[0] : rawName;
        let normalizedName = nameParser( rawSplitName );

        for ( let $extra of $item.ExtendedData.SchemaData.SimpleData ) {

            if ( $extra._attributes.name === 'STATEFP' ) {
                normalizedStateName = nameParser( statefips[$extra._text] );
            } else if ( $extra._attributes.name === 'State' ) {
                normalizedStateName = stateabbrev[ Object.keys( stateabbrev ).filter( state => state === $extra._text.toLocaleUpperCase() )[0] ];
                normalizedStateName = nameParser( normalizedStateName );
            }

        }

        const NAME = normalizedStateName ? `${normalizedStateName}_${normalizedName}` : `${normalizedName}`;

        let newResult = result;

        delete newResult.kml.Document.Folder;

        if ( newResult.kml.Document.Style ) {
            delete newResult.kml.Document.Style.IconStyle;
            delete newResult.kml.Document.Style.LabelStyle;
        }

        if ( newResult.kml.Document.Document ) {
            delete newResult.kml.Document.Document;
        }

        delete newResult.kml.Document.Schema.SimpleField;

        delete $item.description;
        delete $item.ExtendedData;

        newResult.kml.Document.name = type;

        $item._attributes.id = NAME;
        $item.name._text = NAME;

        newResult.kml.Document.Folder = {
            name: NAME,
            Placemark: [ $item ]
        };

        let newXML = convert.json2xml( newResult, { compact: true, ignoreComment: true, spaces: 0 } );
        // console.log( newXML );

        newResult = '';

        // if( FILES.length === 1 ) {
        //     let p = Math.round( currentKey / total * 100 );
        //     percentBar( ' resolved', currentKey, total, p, currentKey );
        // } else {
        //     process.stdout.write(`... saving ...\r`);
        // }

        currentKey +=1;

        if ( !dupes.includes( NAME ) ) {

            dupes.push( NAME );

            const F = path.join( DIST, `/${ NAME }.kml` );

            fse.ensureFileSync( F );
            fse.writeFileSync( path.join( DIST, `/${ NAME }.kml` ), newXML );
            // if( FILES.length === 1 ) {
            //     let p = Math.round( currentKey / total * 100 );
            //     percentBar( ' resolved', currentKey, total, p, currentKey );
            // } 
            // else if ( FILES.length > 1 ) {
            // }

            resolve();

        } else {
            // console.log( 'dupe!', NAME );
            // BLACK HOLE
        }

        if( FILES.legnth > 1 ) {
            console.log( total === currentKey );
            // if( total === currentKey ) {

            //     FILES2.shift();
            //     let p = Math.abs( Math.ceil( ( FILES2.length / FILES.length % FILES.length * 100 ) - 100 ) );
            //     percentBar( ' resolved ', FILES2.length, FILES.length, p, Math.abs( FILES.length - FILES2.length ) );

            // }

        }


    });



};

process.stdout.write( `... spooling ...\r` );

if ( type === 'county' || type === 'zip' ) {

    FILES.push( type === 'county' ? SRCCOUNTY : SRCZCTA );
    start();

} else if ( type === 'city' ) {

    readdirp(
        SRCCITYFOLDER,
        {
            type: 'files',
            fileFilter: [ '*.kml' ],
            depth: 1
        }
    )
        .on('data', (entry) => {
            const {fullPath} = entry;
            FILES.push( fullPath );
        })
        // .on('warn', error => console.error('non-fatal error', error))
        .on('error', error => console.error('fatal error', error))
        .on('end', () => start() );

} else if ( type === 'neighborhood') {

    // FILES.push(
    //     `${SRCNEIGHBORHOODFOLDER}/ZillowNeighborhoods-AK.kml`
    // )
    // start();

    readdirp(
        SRCNEIGHBORHOODFOLDER,
        {
            type: 'files',
            fileFilter: [ '*.kml' ],
            depth: 1
        }
    )
        .on('data', (entry) => {
            const {fullPath} = entry;
            FILES.push( fullPath );
        })
        // .on('warn', error => console.error('non-fatal error', error))
        .on('error', error => console.error('fatal error', error))
        .on('end', () => start() );

} else {
    console.log( 'check the KEY in argv!!!');
}
