import { createPosition, type Action, type GameState, type PieceInput, type Promotion } from '../../src/core'
import { TEACHING_FIXTURES } from '../../src/core/teaching'

export interface FinaleFixture {id:string; before:GameState; command:Action}
const white = (id:string,type:PieceInput['type'],square:string):PieceInput => ({id,type,square,side:'white'})
const black = (id:string,type:PieceInput['type'],square:string):PieceInput => ({id,type,square,side:'black'})
const normal = (pieceId:string,to:string):Action => ({type:'move',mode:'normal',pieceId,to})
const corner = [white('wk','king','f7'),white('wp','pawn','g6'),white('wr','rook','a6'),black('bk','king','h8')]
const promotion = createPosition({energy:{white:1},pieces:[white('wk','king','f6'),white('wp','pawn','f7'),white('wr','rook','g1'),black('bk','king','h8'),black('br','rook','g8')]})
export const finaleFixtures:FinaleFixture[] = [
  {id:'corner',before:createPosition({pieces:corner}),command:normal('wr','a8')},
  {id:'capture',before:createPosition({pieces:[...corner,black('br','rook','a8')]}),command:normal('wr','a8')},
  {id:'white-edge',before:createPosition({side:'black',pieces:[white('wk','king','e1'),black('bk','king','e3'),black('br','rook','a3')]}),command:normal('br','a1')},
  {id:'crowded',before:createPosition({pieces:[white('wk','king','a1'),white('wn','knight','h6'),black('bk','king','h8'),
    black('bn','knight','g8'),black('bp','pawn','h7'),black('gp','pawn','g7')]}),command:normal('wn','f7')},
  {id:'ability',before:createPosition({energy:{white:3},pieces:[white('wk','king','f7'),white('wb','bishop','d4'),white('screen','pawn','e5'),
    black('bk','king','h8'),black('bn','knight','g8'),black('bp','pawn','h7'),black('br','rook','g7')]}),
    command:{type:'ability',mode:'impulse',pieceId:'wb',targetId:'br'}},
  ...(['queen','rook','bishop','knight'] as Promotion[]).map(type=>({id:type==='queen'?'promotion':'promotion-'+type,
    before:promotion,command:{...normal('wp','g8'),promotion:type}})),
  {id:'forced-promotion',before:createPosition({energy:{white:3},pieces:[white('wk','king','d3'),white('wr','rook','a4'),black('bk','king','h8'),black('bp','pawn','a2')]}),
    command:{type:'ability',mode:'impulse',pieceId:'wr',targetId:'bp'}},
  ...TEACHING_FIXTURES.filter(item=>item.id==='check'||item.id==='raid').map(item=>({id:item.id,before:item.state,command:item.expected})),
]
