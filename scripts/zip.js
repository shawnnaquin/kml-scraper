const fse = require('fs-extra');
const path = require('path');
const xmlReader = require('read-xml');
const convert = require('xml-js');
const statefips = require('../src/statefips.json');

const FILE = path.resolve( __dirname, '../src/cb_2017_us_zcta510_500k.kml');
const DIST = path.resolve( __dirname, '../dist/zip/' );

fse.removeSync( DIST );

xmlReader.readXML( fse.readFileSync( FILE ), (err, data) => {

    if ( err ) {
        console.error( err );
    }

    let xml = data.content;
    let result = JSON.parse( convert.xml2json( xml, { compact: true, spaces: 4 } ) );
    let places = result.kml.Document.Folder.Placemark;

    Object.keys( places ).forEach( ( place, placeIndex ) => {
        let $item = places[place];
        // let $item = places[0];
        // console.log( $item );
        let normalizedStateName;
        let rawName = $item.name._text.split(' ').join('_');
        let parsedName = rawName.split('<at><openparen>')[1].split('<closeparen>')[0];
        let lowerCaseName = parsedName.toLocaleLowerCase();
        let normalizedName = lowerCaseName.normalize('NFD').replace(/[\u0300-\u036f]/g, "");

        let newResult = result;

        delete newResult.kml.Document.Folder;

        newResult.kml.Document.name = 'ZCTA';

        $item._attributes.id = `${normalizedName}`;
        $item.name._text = `${normalizedName}`;

        newResult.kml.Document.Folder = {
            name: `${normalizedName}`,
            Placemark: [ $item ]
        };
        let newXML = xml;
        newXML = convert.json2xml( newResult, {compact: true, ignoreComment: true, spaces: 4 } );

        const FOLDER = path.join( DIST );

        fse.ensureDir( FOLDER )
            .then(() => {
                const FILE = path.join( FOLDER, `/${normalizedName}.kml`);
                fse.ensureFile( FILE )
                    .then(() => {
                        fse.writeFile( FILE, newXML, function(err, data) {
                            if (err) {
                                console.log(err);
                            }
                            else {
                                // console.log('updated!');
                            }
                        });
                    })
                    .catch(err => {
                        console.error(err)
                    })
            })
            .catch(err => {
                console.error(err)
            });

    });

});