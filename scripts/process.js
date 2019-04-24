const fse = require('fs-extra');
const path = require('path');
const xmlReader = require('read-xml');
const convert = require('xml-js');

const statefips = require('../src/statefips.json');

let type = process.argv.includes('--county') ?
    'county' : 'zip';

const DIST = path.resolve( __dirname, `../dist/complex/${type}/` );

const FILE = type === 'county' ?
    path.resolve( __dirname, '../src/cb_2017_us_county_20m.kml') :
    path.resolve( __dirname, '../src/cb_2017_us_zcta510_500k.kml');

let size = fse.statSync( FILE ).size;

let dupes = [];

let current = 0;
let percent = '';
let content = '';
let downloaded = 0;

let reset = () => {
    current = 0;
    percent = "[------------------------------]";
    percent = percent.split('');
};

reset();

fse.removeSync( DIST );

let decodedXMLStream = fse.createReadStream( FILE ).pipe(
    xmlReader.createStream()
);

decodedXMLStream.on( 'data', ( xmlStr ) => {

    content += xmlStr;
    downloaded += xmlStr.length;

    let factor = 100;
    let dlSize = downloaded/factor;
    let contentSize = size;

    let per = Math.round( ( dlSize/(contentSize/10000) ) * 0.3 );

    // percent[ per + 1 ] = '#';
    percent.fill('#', 1, per+1 );

    let t = `${ percent.join('') }`;

    if (  dlSize/(contentSize/100000000000) > 999990000 ) {
        process.stdout.write( `...reading... ${t} ${Math.round( per/3*10 )}%\n` );
        process.stdout.write( 'done reading!\n' );
    } else {
        process.stdout.write( `...reading... ${t} ${Math.round( per/3*10 )}%\r` );
    }

});

decodedXMLStream.on( 'end', () => {
    done( content );
});

let done = ( data ) => {

    reset();
    console.log( 'converting...                                                         \n');
    let xml = data;
    let result = JSON.parse( convert.xml2json( xml, { compact: true, spaces: 4 } ) );
    let places = result.kml.Document.Folder.Placemark;

    size = Object.keys( places ).length;

    let dlSize = 0;

    let timer;

    let percentBar = () => {

        dlSize+=1;

        let per = Math.round( ( dlSize/size*100 ) * 0.3 );
        // percent[ per + 1 ] = '#';
        percent.fill('#', 1, per+1 );

        let t = `${ percent.join('') }`;
        // console.log( );
        if (  dlSize/size*100 >= 99 ) {
            clearTimeout( timer );
            timer = setTimeout( ()=> {
                process.stdout.write( `saving JSON : ${t} ${Math.round( per/3*10 )}%\n` );
                console.log( `done saving!                                                `);
            }, 1000 );
        } else {
            process.stdout.write( `processing : ${t} ${Math.round( per/3*10 )}%\r` );
        }

    };

    Object.keys( places ).forEach( ( place, placeIndex ) => {

        let $item = places[place];
        // let $item = places[0];
        let normalizedStateName;

        let rawName = $item.name._text.split(' ').join('_');
        let parsedName = rawName.split('<at><openparen>')[1].split('<closeparen>')[0];
        let lowerCaseName = parsedName.toLocaleLowerCase();
        let normalizedName = lowerCaseName.normalize('NFD').replace(/[\u0300-\u036f]/g, "");

        for ( let $extra of $item.ExtendedData.SchemaData.SimpleData ) {

            if ( $extra._attributes.name === 'STATEFP' ) {
                normalizedStateName = statefips[$extra._text].split(' ').join('_').toLocaleLowerCase();
            }

        }

        const NAME = normalizedStateName ? `${normalizedStateName}_${normalizedName}` : `${normalizedName}`;

        let newResult = result;

        delete newResult.kml.Document.Folder;
        delete newResult.kml.Document.Style.IconStyle;
        delete newResult.kml.Document.Style.LabelStyle;
        delete newResult.kml.Document.Schema.SimpleField

        delete $item.description;
        delete $item.ExtendedData;

        newResult.kml.Document.name = type;

        $item._attributes.id = NAME;
        $item.name._text = NAME;


        newResult.kml.Document.Folder = {
            name: NAME,
            Placemark: [ $item ]
        };

        let newXML = xml;

        newXML = convert.json2xml( newResult, { compact: true, ignoreComment: true, spaces: 0 } );


        if ( !dupes.includes( NAME ) ) {

            fse.ensureDir( DIST )
                .then( ( ) => {
                    const FILE = path.join( DIST, `/${ NAME }.kml` );
                    fse.ensureFile( FILE )
                        .then( ( ) => {
                            fse.writeFile( FILE, newXML, function( err, data ) {
                                if (err) {
                                    console.log( err );
                                } else {
                                    percentBar();
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
            dupes.push( NAME );
        } else {
            // console.log( 'dupe!', NAME );
            // BLACK HOLE
        }

    });

}
