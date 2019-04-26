module.exports = {

    nameparser: ( name ) => {
        return name.split('/').join('-').split('\'').join('')
            .split("\"").join('')
            .split('(').join('')
            .split(')').join('')
            .split(',').join('')
            .split('&').join('')
            .split(' ').join('_')
            .toLocaleLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, "")
            .split('/').join('-');
    }

}