import type { Context } from "hono";
import { insertMemberSchema, updateMemberSchema, selectMemberSchema  } from "./members.schema.js";
import { addMember, getAllTeamMembers, updateMember } from "./members.service.js"
import z from "zod";

export const handleAddMember = async (c: Context) => {
    try {
        const data = await c.req.json()
        const parsedData = insertMemberSchema.parse(data)
        const teamId = c.req.param('id')

        const insertedMember = await addMember(parsedData, teamId)
        return c.json({ success: true, data: insertedMember }, 201)

    } catch (error: any) {

    }

}


// id alone should be enough
// However, since a member's info has universal information besides teamId, there might be a better way to handle member data
export const handleUpdateMemberInfo = async (c: Context) => {
    try{
        const id = c.req.param('id')
        const data = await c.req.json()
        const parsedData = updateMemberSchema.parse(data)

        const updatedMember = await updateMember(parsedData, id)
        return c.json({success: true, data: updatedMember}, 202)
        
    } catch (error: any){
        
    }
}

export const handleGetAllTeamMembers = async (c: Context) => {
    try {
        const teamId = c.req.param('id')

        const data = await getAllTeamMembers(teamId)
        const parsedData = z.array(selectMemberSchema).parse((data))
        return c.json({ data: parsedData })
    } catch (error: any) {

    }
}
// export const handleGetMember = async (c: Context) => {
//     try {
//         const teamId = c.req.param('id')
//
//         const data = await getAllTeamMembers(teamId)
//         const parsedData = z.array(selectMemberSchema).parse((data))
//         return c.json({ data: parsedData[0] })
//     } catch (error: any) {
//
//     }
// }
