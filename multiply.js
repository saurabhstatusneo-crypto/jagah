function multiply(a,b){
     const product = a*b ; 
     return product ===0 ? 0 : product; 
}

let a = 5 ; 
let b =1 ; 
console.log(multiply(a,b));

module.exports = multiply