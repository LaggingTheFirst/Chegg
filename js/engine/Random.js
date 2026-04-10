export class Random {
    static shuffleInPlace(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    static shuffleCopy(array) {
        return this.shuffleInPlace([...array]);
    }
}

export default Random;
