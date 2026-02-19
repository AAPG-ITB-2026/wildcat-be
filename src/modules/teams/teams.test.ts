import { insertTeamSchema } from "./teams.schema.js";

try {
    insertTeamSchema.parse({}) // parse empty object
} catch (err: any){
    console.log("Validation Failed")
    console.table(err.flatten().fieldErrors)
}
