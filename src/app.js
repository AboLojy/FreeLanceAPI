const express = require('express');
const bodyParser = require('body-parser');
const { sequelize } = require('./model')
const { Op } = require('sequelize');
const { getProfile } = require('./middleware/getProfile')
var { Mutex } = require('async-mutex');
const mutex = new Mutex();
const app = express();

app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)
const UNPAID = {
    paid: {
        [Op.or]: {
            [Op.is]: null, [Op.not]: true
        }
    }
}
const ACTIVE_CONTRACT = {
    status: {
        [Op.ne]: "terminated"
    }
}
const GetAllUnpaidJobs = async (app, clientid, param) => {
    const { Job, Contract } = app.get('models')
    return Job.findAll({
        where: {
            ...UNPAID
        },
        include: {
            model: Contract,
            attributes: [],
            required: true,
            where: {
                ...ACTIVE_CONTRACT,
                clientid: clientid
            }
        }
    }, param)
}
/**
 * FIX ME!
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models')
    const { id } = req.params;
    const profile = req.profile.dataValues;
    const target = profile.type === 'client' ? { ClientId: profile.id } : { ContractorId: profile.id };

    const contract = await Contract.findOne({ where: [{ id }, target] })
    if (!contract) return res.sendStatus(404)
    res.json(contract)
})
app.get('/contracts', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models')
    const profile = req.profile.dataValues;
    const target = profile.type === 'client' ? { ClientId: profile.id } : { ContractorId: profile.id };
    const contract = await Contract.findAll({
        where: {
            [Op.and]: [
                target,
                ...ACTIVE_CONTRACT
            ]
        }
    })
    if (!contract) return res.sendStatus(404)
    res.json(contract)
})
app.post('/jobs/:job_id/pay', async (req, res) => {
    const { Contract, Job, Profile } = req.app.get('models')
    const currProfile = req.get('profile_id');
    const { job_id } = req.params;
    var result = null;

    await mutex.runExclusive(async () => {
        try {

            const tr_result = await sequelize.transaction(async (t) => {

                const profile = await Profile.findOne({ where: { id: currProfile } }, { transaction: t, lock: true });
                const job = await Job.findOne({
                    where: {
                        ...UNPAID,
                        id: job_id
                    },
                    include: {
                        model: Contract,
                        attributes: [],
                        required: true,
                        where: {
                            ...ACTIVE_CONTRACT,
                            clientid: currProfile
                        }
                    }
                }, { transaction: t, lock: true });
                if (!job) {
                    result = res.sendStatus(404);
                    return;
                }
                const contract = await Contract.findOne({ where: { id: job.dataValues.ContractId } }, { transaction: t, lock: true });
                if (!contract) {
                    res.sendStatus(404)
                    return;
                }
                if (profile.dataValues.balance < job.dataValues.price) {
                     res.status(400).send({ message: "insuffecient" });
                    return;
                }
                console.log("Job Data :", job.dataValues.ContractId);
                await Profile.update({ balance: profile.dataValues.balance - job.dataValues.price }, { where: { id: currProfile } }, { transaction: t });
                await Job.update({ paid: 1, paymentDate: (new Date()).toISOString() }, { where: { id: currProfile } }, { transaction: t });
                await Contract.update({ status: "terminated" }, { where: { id: job.dataValues.ContractId } }, { transaction: t });
                profile.dataValues.balance = profile.dataValues.balance - job.dataValues.price;
                 res.json( profile);
                return;
            });

        } catch (error) {
            console.log(error);
            res.sendStatus(500);
            return;
        }
    });
    
   
})

app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const job = await GetAllUnpaidJobs(req.app, req.get('profile_id'))
    if (!job) return res.status(404).end()
    res.json(job)
})

app.post('/balances/deposit/:userId', async (req, res) => {
    const { userId } = req.params;
    const { Profile } = req.app.get('models')
    const { amount } = req.body;
    var result = null;
    await mutex.runExclusive(async () => {
        try {
            const tr_result = await sequelize.transaction(async (t) => {

                const job = await GetAllUnpaidJobs(req.app, userId, { transaction: t, lock: true })

                var total = 0;
                if (!job) {
                    res.sendStatus(404);
                    return;
                }

                job.forEach(element => {
                    total += element.dataValues.price;
                });
                console.log(total, "user id = ", userId, "amount = ", amount);
                if (amount > total * 0.25) {
                    res.sendStatus(406);
                    return;
                }

                const user = await Profile.findOne({where:{id:userId}}, { transaction: t, lock: true });

                await Profile.update({ balance: user.dataValues.balance + amount }, { where: { id: userId } }, { transaction: t });

                user.dataValues.balance = user.dataValues.balance + amount;
                res.sendStatus(200).json(user);
                return;
            })
        }
        catch (error) {
            console.log(error);
            res.sendStatus(500);
            return;
        }
    });

    return result;
})
module.exports = app;
